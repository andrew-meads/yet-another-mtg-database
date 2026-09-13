"""
pHash verification of detection candidates (plan idea A8).

A quad that passes every geometric filter can still be a coaster, a phone or
the art box of a card. The one thing all of those have in common is that they
do not look like *any* card in the index, and the index already holds a 64-bit
pHash of every indexed face. So each surviving candidate is warped to a small
portrait thumbnail, hashed at 0° and 180°, and its minimum Hamming distance to
the whole index decides:

* ``<= VERIFY_MAX_HAMMING`` (12): **accepted** — a real, indexed card. Random
  64-bit hashes sit at 32 ± 4 bits from each other; genuine crops of indexed
  cards measure 8–12.
* ``<= VERIFY_AMBIGUOUS_HAMMING`` (18): **ambiguous** — kept, but
  :mod:`app.main` drops it unless Stage 2 (ORB + RANSAC) finds enough inliers.
* beyond: **rejected** with reason ``hash``.

The distance also tells the crop's orientation for free: the variant (0 or
180) that produced the minimum is how the card is lying.

Why the zones only bite in ``filter`` mode: the index is built one set at a
time, and while it is partial a card from an un-indexed set is far from
everything — dropping it would make the scanner silently blind to whole sets.
:func:`effective_mode` therefore resolves ``VERIFY_MODE=auto`` to ``filter``
only once the index holds ``VERIFY_MIN_INDEX_SIZE`` faces, and to ``rank``
(distances used for ordering only; nothing rejected, nothing ambiguous)
before that. An empty index or an unreachable database degrades to a no-op:
:func:`app.matcher.nearest_hash_distance` returns ``None`` and every candidate
stays ``unverified``. Verification never raises and never blocks a scan.
"""

from __future__ import annotations

import numpy as np

from . import config, matcher
from .candidates import Candidate, edge_support
from .geometry import portrait_quad, warp_ordered_quad

__all__ = ["edge_support", "effective_mode", "hash_verify", "warp_small"]

MODES = ("auto", "rank", "filter", "off")


def warp_small(work: np.ndarray, quad: np.ndarray, long_edge: int | None = None) -> np.ndarray:
    """Portrait thumbnail of ``quad`` cut from the working image.

    ``long_edge`` px tall (default :data:`config.VERIFY_THUMB_LONG_EDGE`), width
    from the card aspect. pHash reduces to 32×32 before the DCT, so 180 px is
    already more than it uses; the thumbnail exists to keep the warp cheap
    (~0.2 ms) rather than for detail. The same :func:`portrait_quad` rule as
    the final crop decides which way is "up", so the orientation learnt here
    applies to the crop the detector returns.
    """
    height = long_edge or config.VERIFY_THUMB_LONG_EDGE
    width = max(int(round(height * config.CARD_ASPECT_RATIO)), 1)
    return warp_ordered_quad(work, portrait_quad(quad), width, height)


def effective_mode(mode: str | None = None) -> str:
    """Resolve ``auto`` to ``filter`` or ``rank`` from the live index size.

    Any failure to learn the index size (database down, pool blocked) counts as
    "small", i.e. ``rank`` — the safe direction.
    """
    mode = (mode or config.VERIFY_MODE).strip().lower()
    if mode not in MODES:
        mode = "auto"
    if mode != "auto":
        return mode
    try:
        size = matcher.index_size()
    except Exception:  # noqa: BLE001 — verification must never take a scan down
        size = 0
    return "filter" if size >= config.VERIFY_MIN_INDEX_SIZE else "rank"


def hash_verify(cands: list[Candidate], work: np.ndarray, *, mode: str | None = None) -> str:
    """Hash every alive candidate and set its ``verify`` / ``hash_distance`` / ``orientation``.

    Args:
        cands: Candidates in working-image coordinates (rejected ones are skipped).
        work: The working image the quads refer to.
        mode: Override for ``VERIFY_MODE`` (tests); ``None`` reads config.

    Returns:
        The effective mode that was applied (``off`` when nothing was hashed).
    """
    mode = effective_mode(mode)
    if mode == "off":
        return mode
    for cand in cands:
        if not cand.alive:
            continue
        try:
            result = matcher.nearest_hash_distance(warp_small(work, cand.quad))
        except Exception:  # noqa: BLE001 — a DB hiccup must not fail detection
            result = None
        if result is None:
            continue  # empty index: leave the candidate unverified
        distance, variant = result
        cand.hash_distance = int(distance)
        cand.orientation = int(variant)
        if cand.source == "completed":
            # A rebuilt card's warp holds a slice of the occluder, so it hashes
            # worse than a clean crop and is never trusted on the hash alone:
            # ambiguous at best, so the ORB gate decides.
            if mode == "filter" and distance > config.VERIFY_COMPLETED_HAMMING:
                cand.verify = "rejected"
                cand.rejected = "hash"
            else:
                cand.verify = "ambiguous"
            continue
        if distance <= config.VERIFY_MAX_HAMMING:
            cand.verify = "accepted"
        elif mode == "filter" and distance <= config.VERIFY_AMBIGUOUS_HAMMING:
            cand.verify = "ambiguous"
        elif mode == "filter":
            cand.verify = "rejected"
            cand.rejected = "hash"
        else:
            cand.verify = "unverified"
    return mode


def orb_gate(card, matches: list[dict], *, mode: str | None = None) -> bool:
    """Whether a detection survives the Stage-2 gate (True = keep).

    After identification every kept detection has a ranked match list. A real
    card's best match carries tens of validated inliers; a piece of table,
    cushion or playmat that slipped through hash verification has none
    (measured: >= 26 vs 0 on the labelled photos). So in ``filter`` mode a
    detection whose best match has fewer than ``VERIFY_MIN_INLIERS`` inliers is
    dropped — for every detection with ``VERIFY_ORB_GATE=all``, only for the
    hash-``ambiguous`` ones with ``ambiguous``. In ``rank`` mode (small or empty
    index) nothing is dropped: a card from an unindexed set scores 0 too.
    """
    top_inliers = int(matches[0].get("inliers", 0)) if matches else 0
    if top_inliers >= config.VERIFY_MIN_INLIERS:
        return True
    if getattr(card, "verify", "") == "ambiguous":
        return False
    return not (config.VERIFY_ORB_GATE == "all" and effective_mode(mode) == "filter")

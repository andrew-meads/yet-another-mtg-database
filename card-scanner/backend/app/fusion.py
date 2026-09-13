"""
Shortlist union and score fusion — how text evidence joins the image pipeline.

Stage 1 (pHash) is a recall floor: the true card is usually somewhere in its
top-K, but on real photos it is a flat band of same-frame ties. The OCR passes
in ``app.names`` add two more ways to nominate candidates — a fuzzy name hit
and a collector-line hit — and this module decides (a) which rows Stage 2
should spend feature matching on and (b) how the three kinds of evidence are
combined once Stage 2 has counted inliers.

* :func:`build_shortlist` (plan item B5) takes the *union* of collector rows,
  capped name rows and the hash top-K, in that priority order. OCR can only
  add candidates, never remove the hash shortlist, so a misread degrades to
  today's behaviour instead of below it.
* :func:`fuse` (B7) turns Stage-2 inlier counts plus name / collector bonuses
  into one number. The weights are chosen so a decisive ORB win is never
  overturned by a weak name (12 points at most, only for a perfect read) while
  a flat tie among foil reprints *is* decided by text.
* :func:`confidence` (B7) implements the confident rules A (image margin, the
  pre-OCR rule), B (name-anchored) and C (collector-anchored), plus the veto
  that stops a strong name read from being contradicted silently.

Everything here is pure: rows are integer positions into the matcher's cached
arrays, and the metadata each rule needs travels inside :class:`Scored`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .names import CollectorHit, NameHit, NameTable

# Evidence source labels carried on every shortlist entry and result.
SOURCE_HASH = "hash"
SOURCE_NAME = "name"
SOURCE_CN = "cn"


@dataclass
class ShortlistEntry:
    """One Stage-2 candidate: an index row position and who nominated it."""

    row: int
    sources: set[str] = field(default_factory=set)


def build_shortlist(
    hash_ranked: np.ndarray,
    hash_distances: np.ndarray,
    name_hits: list[NameHit],
    table: NameTable,
    cn_rows: np.ndarray | None,
    *,
    name_max_rows: int = 40,
    shortlist_max: int = 220,
) -> list[ShortlistEntry]:
    """Union the three candidate sources into one ordered, capped shortlist.

    Args:
        hash_ranked: Row positions sorted by Hamming distance ascending, already
            cut to the hash top-K.
        hash_distances: Hamming distance per row over the *whole* index (used
            to pick the closest rows of a name that has hundreds of printings).
        name_hits: Ranked hits from :func:`app.names.match_names`.
        table: The :class:`NameTable` (for ``rows_by_key``).
        cn_rows: Rows from :func:`app.names.lookup_collector`, or None.
        name_max_rows: Per matched key, keep at most this many rows, chosen by
            lowest Hamming distance — a basic land matched by name would
            otherwise add ~1000 rows.
        shortlist_max: Hard cap on the result. Hash-only rows are dropped from
            the tail first (they are the least specific evidence); if that is
            not enough the tail is truncated.

    Returns:
        Entries in Stage-2 order — collector rows, then name rows, then hash
        rows — with the sources of duplicated rows merged onto one entry.
    """
    entries: dict[int, ShortlistEntry] = {}

    def _add(row: int, source: str) -> None:
        entry = entries.get(row)
        if entry is None:
            entries[row] = ShortlistEntry(row, {source})
        else:
            entry.sources.add(source)

    if cn_rows is not None and len(cn_rows):
        cn_rows = np.asarray(cn_rows, dtype=np.int64)
        # Closest-by-hash first so an early exit in Stage 2 sees the best rows.
        for row in cn_rows[np.argsort(hash_distances[cn_rows], kind="stable")]:
            _add(int(row), SOURCE_CN)

    for hit in name_hits:
        rows = table.rows_by_key.get(hit.key)
        if rows is None or not rows.size:
            continue
        if rows.size > name_max_rows:
            order = np.argsort(hash_distances[rows], kind="stable")[:name_max_rows]
            rows = rows[order]
        else:
            rows = rows[np.argsort(hash_distances[rows], kind="stable")]
        for row in rows:
            _add(int(row), SOURCE_NAME)

    for row in hash_ranked:
        _add(int(row), SOURCE_HASH)

    ordered = list(entries.values())
    if len(ordered) > shortlist_max:
        excess = len(ordered) - shortlist_max
        keep: list[ShortlistEntry] = []
        # Walk from the tail: hash-only rows go first because they are also
        # the rows with the worst Hamming distance (hash_ranked is sorted).
        for entry in reversed(ordered):
            if excess and entry.sources == {SOURCE_HASH}:
                excess -= 1
                continue
            keep.append(entry)
        ordered = keep[::-1]
        if excess:
            ordered = ordered[: len(ordered) - excess]
    return ordered


@dataclass
class Scored:
    """A Stage-2 result plus the metadata the fusion rules need.

    Attributes:
        row: Index row position.
        inliers_valid: RANSAC inliers (0 when the homography failed validation).
        hamming: Stage-1 Hamming distance of this row.
        name_key: The row's ``name_key`` (may be None on a pre-backfill index).
        face_name_keys: Every key the row answers to (see ``app.metadata``).
        set_code / cn_norm / cn_base: Collector identity of the row.
        oracle_id: Scryfall oracle id — rows sharing it are printings of the
            same card and do not compete with each other for confidence.
        sources: Which shortlist sources nominated the row.
    """

    row: int
    inliers_valid: int
    hamming: int
    name_key: str | None = None
    face_name_keys: list[str] = field(default_factory=list)
    set_code: str | None = None
    cn_norm: str | None = None
    cn_base: str | None = None
    oracle_id: str | None = None
    sources: set[str] = field(default_factory=set)
    # Scryfall `border_color` of the row (black / white / gold / silver / borderless).
    border_color: str | None = None

    @property
    def keys(self) -> set[str]:
        """All name keys this row answers to (``name_key`` ∪ ``face_name_keys``)."""
        keys = set(self.face_name_keys)
        if self.name_key:
            keys.add(self.name_key)
        return keys


@dataclass
class FusedScore:
    """A :class:`Scored` entry with its fused score and the bonus breakdown."""

    entry: Scored
    fused: float
    name_bonus: float
    cn_bonus: float


def _best_scores_by_key(name_hits: list[NameHit]) -> dict[str, float]:
    best: dict[str, float] = {}
    for hit in name_hits:
        if hit.score > best.get(hit.key, 0.0):
            best[hit.key] = hit.score
    return best


def _name_bonus(entry: Scored, best_by_key: dict[str, float], min_score: float) -> float:
    """0–1: how well the best name hit for any of this row's keys scored.

    Linear from ``min_score`` (0) to a perfect read (1), so a hit that barely
    cleared the floor contributes almost nothing.
    """
    best = max((best_by_key.get(k, 0.0) for k in entry.keys), default=0.0)
    if best <= min_score:
        return 0.0
    return min(1.0, (best - min_score) / (100.0 - min_score))


def _cn_bonus(entry: Scored, cn_hit: CollectorHit | None, name_bonus: float) -> float:
    """0–1: how well the row's collector identity agrees with the OCR'd line."""
    if (
        cn_hit is not None
        and cn_hit.set_code
        and entry.cn_norm == f"{cn_hit.set_code}-{cn_hit.number}"
    ):
        return 1.0  # The List reprints print the original set code + number
    if cn_hit is None or not entry.cn_norm:
        return 0.0
    if cn_hit.set_code:
        if entry.set_code and entry.set_code.lower() == cn_hit.set_code:
            if entry.cn_norm == cn_hit.number:
                return 1.0
            if entry.cn_base == cn_hit.base:
                return 0.75
        return 0.0
    # No set code read: a bare number matches hundreds of rows across sets, so
    # it only counts when the name pass independently points at this row.
    if name_bonus > 0 and (entry.cn_norm == cn_hit.number or entry.cn_base == cn_hit.base):
        return 0.5
    return 0.0


def fuse(
    scored: list[Scored],
    name_hits: list[NameHit],
    cn_hit: CollectorHit | None,
    *,
    name_w: float = 12.0,
    cn_w: float = 10.0,
    hash_w: float = 0.05,
    min_score: float = 80,
    crop_border: str | None = None,
    border_w: float = 8.0,
) -> list[FusedScore]:
    """Combine Stage-2 inliers with the text evidence and rank.

    ``fused = inliers_valid + name_w·name_bonus + cn_w·cn_bonus + border_w·border_bonus − hash_w·hamming``

    ``name_bonus`` is the best hit over the row's keys, rescaled from
    ``min_score``..100 to 0..1; ``cn_bonus`` is 1.0 for an exact ``(set,
    number)`` agreement, 0.75 for the ``(set, base)`` family, 0.5 for a
    set-less number that also has name support, else 0. The Hamming term is
    tiny by design: with the ~10-bit spread inside a hash shortlist it only
    breaks ties (a spread of 20 bits equals one inlier at the default weight),
    so the no-OCR path keeps today's ordering of inliers desc, hash asc.

    Returns entries sorted by ``fused`` descending; ties keep hash ascending.
    """
    best_by_key = _best_scores_by_key(name_hits)
    results: list[FusedScore] = []
    for entry in scored:
        nb = _name_bonus(entry, best_by_key, min_score)
        cb = _cn_bonus(entry, cn_hit, nb)
        bb = _border_bonus(entry, crop_border)
        fused = (
            entry.inliers_valid + name_w * nb + cn_w * cb + border_w * bb - hash_w * entry.hamming
        )
        results.append(FusedScore(entry, fused, nb, cb))
    # Python's sort is stable, so equal (fused, hamming) keep input order.
    results.sort(key=lambda r: (-r.fused, r.entry.hamming))
    return results


def confidence(
    ranked: list[FusedScore],
    name_hits: list[NameHit],
    cn_hit: CollectorHit | None,
    *,
    min_inliers: int = 15,
    margin: float = 2.0,
    name_confident_score: float = 92,
    min_inliers_with_name: int = 6,
    min_inliers_with_cn: int = 6,
    ambiguity_gap: float = 5,
    veto_score: float = 95,
) -> list[tuple[bool, str | None]]:
    """Decide ``(confident, rule)`` for every ranked entry.

    Rank 0 is confident under the first rule that holds:

    * ``"A"`` — image margin: ``inliers ≥ min_inliers`` and at least ``margin``
      times the best competitor with a *different* ``oracle_id`` (other
      printings of the same card are siblings, not competitors).
    * ``"B"`` — name-anchored: one of the leader's keys matched at
      ``≥ name_confident_score``, no *other* key matched within
      ``ambiguity_gap`` of it, and ``inliers ≥ min_inliers_with_name``.
    * ``"C"`` — collector-anchored: the leader is the exact ``(set, number)``
      of the collector hit and ``inliers ≥ min_inliers_with_cn``.

    Veto: a key matched at ``≥ veto_score`` that the leader does *not* carry,
    while the leader fails to beat the best row carrying that key by
    ``margin``, makes rank 0 not confident (rule None) — a near-certain name
    read must not be silently contradicted by a marginal image win.

    Ranks > 0 are confident iff ``inliers ≥ min_inliers``, always with rule
    None (only the leader is ever acted on automatically).
    """
    if not ranked:
        return []

    top = ranked[0].entry
    top_keys = top.keys

    # Rule A — same margin test the pre-OCR matcher used.
    competitor = 0
    for fs in ranked[1:]:
        if fs.entry.oracle_id != top.oracle_id:
            competitor = fs.entry.inliers_valid
            break
    rule_a = top.inliers_valid >= min_inliers and top.inliers_valid >= margin * max(competitor, 1)

    # Rule B — the name read is unambiguous and the image agrees a little.
    best_by_key = _best_scores_by_key(name_hits)
    top_name_score = max((best_by_key.get(k, 0.0) for k in top_keys), default=0.0)
    other_best = max((s for k, s in best_by_key.items() if k not in top_keys), default=0.0)
    rule_b = (
        top_name_score >= name_confident_score
        and other_best <= top_name_score - ambiguity_gap
        and top.inliers_valid >= min_inliers_with_name
    )

    # Rule C — exact collector identity and the image agrees a little.
    rule_c = (
        cn_hit is not None
        and cn_hit.set_code is not None
        and top.set_code is not None
        and top.set_code.lower() == cn_hit.set_code
        and top.cn_norm == cn_hit.number
        and top.inliers_valid >= min_inliers_with_cn
    )

    rule: str | None = "A" if rule_a else "B" if rule_b else "C" if rule_c else None

    # Veto — a very strong read of a name the leader does not carry.
    vetoed = False
    if rule is not None:
        for key, score in best_by_key.items():
            if score < veto_score or key in top_keys:
                continue
            same_key = max(
                (fs.entry.inliers_valid for fs in ranked[1:] if key in fs.entry.keys),
                default=None,
            )
            if same_key is not None and top.inliers_valid < margin * same_key:
                vetoed = True
                break

    out: list[tuple[bool, str | None]] = [
        (rule is not None and not vetoed, None if vetoed else rule)
    ]
    out.extend((fs.entry.inliers_valid >= min_inliers, None) for fs in ranked[1:])
    return out


# Border colours the crop classifier can produce and that the index records.
_CLASSIFIABLE_BORDERS = frozenset({"black", "white", "gold", "silver"})


def _border_bonus(entry: Scored, crop_border: str | None) -> float:
    """+0.25 when the crop's border colour agrees with the row, −1 when it clearly
    disagrees, 0 when either side is unknown or the row is borderless.

    Asymmetric on purpose: agreement is the common case and should barely move
    the score, while a confident disagreement (gold vs black) is decisive
    evidence against a printing.
    """
    if crop_border is None or entry.border_color not in _CLASSIFIABLE_BORDERS:
        return 0.0
    return 0.25 if entry.border_color == crop_border else -1.0


def classify_border(crop_bgr) -> str | None:
    """Classify a crop's outer ring as ``black`` / ``white`` / ``gold`` / ``silver``.

    Samples the outer 2 % of the (portrait, frame-filling) crop on all four sides
    and looks at the median colour in HSV. Thresholds are deliberately loose in
    the middle: anything that is not clearly one of the four returns ``None`` so
    the fusion never penalises on a guess (borderless art, glare, deep shadow).
    """
    import cv2  # local import: keeps this module importable without OpenCV in pure tests
    import numpy as np

    h, w = crop_bgr.shape[:2]
    t = max(2, int(round(0.02 * w)))
    ring = np.concatenate(
        [
            crop_bgr[:t].reshape(-1, 3),
            crop_bgr[-t:].reshape(-1, 3),
            crop_bgr[:, :t].reshape(-1, 3),
            crop_bgr[:, -t:].reshape(-1, 3),
        ]
    )
    med = np.median(ring, axis=0).astype(np.uint8).reshape(1, 1, 3)
    hue, sat, val = (int(x) for x in cv2.cvtColor(med, cv2.COLOR_BGR2HSV)[0, 0])
    if val < 70:
        return "black"
    if val > 180 and sat < 45:
        return "white"
    if sat > 70 and 12 <= hue <= 35 and val > 90:
        return "gold"
    if sat < 45 and 110 <= val <= 180:
        return "silver"
    return None


def _cn_consistent(entry: Scored, hit: CollectorHit) -> bool:
    """Whether a row could have printed the collector line that was read.

    Beyond the exact ``(set, number)`` this accepts the same base number in the
    parent's promo set (``pmh2`` for a ``MH2`` read — promos print the parent
    code), a set-less read whose number matches, and The List's ``SET-NUM`` form.
    """
    if entry.cn_norm is None:
        return False
    number_ok = entry.cn_norm == hit.number or (entry.cn_base or "") == hit.base
    if hit.set_code is None:
        return number_ok
    list_form = entry.cn_norm == f"{hit.set_code}-{hit.number}"
    set_ok = entry.set_code in (hit.set_code, "p" + hit.set_code)
    return list_form or (number_ok and set_ok)


def promote_collector_match(
    ranked: list[FusedScore], cn_hit: CollectorHit | None, *, min_inliers: int = 6
) -> list[FusedScore]:
    """Let a collector-line hit pick the *printing* among siblings of the leader.

    Identical-art printings differ in Stage-2 inliers by lighting noise only, so
    a +10 fusion bonus can lose to a 12-inlier gap (measured: Mind Stone DMR 232
    read correctly, ZNC 114 still first on 142 vs 130 inliers). A collector line
    that names an exact ``(set, number)`` (or its family) *of the same card* as
    the current leader is decisive evidence of the printing, so that row moves to
    rank 0 — provided it has at least ``min_inliers`` of its own. A hit naming a
    *different* card is left to the additive score, where the image still rules.
    """
    if cn_hit is None or not ranked:
        return ranked
    leader = ranked[0]
    if _cn_consistent(leader.entry, cn_hit):
        # The image's choice already agrees with the read (a prerelease promo prints
        # its parent's set code and number): the collector line cannot separate the
        # siblings, so the date stamp / foil the features saw must decide.
        return ranked
    siblings = [
        r
        for r in ranked
        if r.entry.oracle_id is not None and r.entry.oracle_id == leader.entry.oracle_id
    ]
    # Exact / family agreement with a set code is decisive on its own. A set-less
    # number (old frames, a misread set line) is decisive only when exactly one
    # sibling printing carries that number — then it names the printing just as well.
    strong = [r for r in siblings if r.cn_bonus >= 0.75 and r.entry.inliers_valid >= min_inliers]
    number_only = [
        r for r in siblings if 0 < r.cn_bonus < 0.75 and r.entry.inliers_valid >= min_inliers
    ]
    pick = strong[0] if strong else (number_only[0] if len(number_only) == 1 else None)
    if pick is None or pick is leader:
        return ranked
    return [pick] + [r for r in ranked if r is not pick]

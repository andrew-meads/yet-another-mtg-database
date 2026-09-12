"""
Two-stage card identification: pHash shortlist → local-feature re-rank.

`identify()` is the single entry point used by the API. It keeps the (small)
table of hashes in an in-memory cache that auto-reloads when the database changes,
so rebuilding the index does not require restarting the server.

Stage 1 (recall): rank every indexed hash by Hamming distance to the query
(considering 0° and 180°), keep the top ``SHORTLIST_K``.
Stage 2 (precision): match local features against each shortlisted candidate and
re-rank by geometric inlier score. The final top-N is returned for human review.
"""

from __future__ import annotations

import threading
import time

import numpy as np

from . import config, features, hashing, index_db

# Module-level cache of the Stage-1 data. Guarded by a lock because FastAPI may
# serve requests concurrently. `sig` is the DB change-token last loaded;
# `checked_at` debounces how often we hit the DB to re-check it.
_lock = threading.Lock()
_EMPTY = (np.empty(0, np.int64), np.empty(0, np.uint64))
_cache: dict = {"sig": None, "checked_at": 0.0, "ids": None, "hashes": None}


def _ensure_loaded() -> None:
    """(Re)load the hash table when the DB's change-signature differs.

    The DB is only consulted at most once per ``INDEX_REFRESH_SECONDS``; within
    that window the cached arrays are reused untouched. DB errors / an empty DB
    present an empty index (never a 500) and are retried next interval.
    """
    now = time.monotonic()
    if _cache["ids"] is not None and (now - _cache["checked_at"]) < config.INDEX_REFRESH_SECONDS:
        return

    with _lock:
        # Re-check inside the lock in case another thread just refreshed.
        now = time.monotonic()
        if _cache["ids"] is not None and (now - _cache["checked_at"]) < config.INDEX_REFRESH_SECONDS:
            return
        try:
            with index_db.connection() as conn:
                sig = index_db.index_signature(conn)
                if _cache["ids"] is None or sig != _cache["sig"]:
                    ids, hashes = index_db.load_hashes(conn)
                    _cache.update(sig=sig, ids=ids, hashes=hashes)
            _cache["checked_at"] = time.monotonic()
        except Exception as err:
            # DB unavailable / not yet initialized must never 500 the API.
            print(f"index load failed: {err}", flush=True)
            _cache.update(sig=None, ids=_EMPTY[0], hashes=_EMPTY[1], checked_at=time.monotonic())


def index_size() -> int:
    """Number of indexed card faces currently loaded."""
    _ensure_loaded()
    return int(len(_cache["ids"]))


def identify(crop_bgr: np.ndarray, top_n: int | None = None) -> list[dict]:
    """Identify a de-skewed card crop against the index.

    Args:
        crop_bgr: A normalised card crop (BGR) from Part 1.
        top_n: How many ranked candidates to return (default from config).

    Returns:
        A list (best first) of match dicts; empty if the index is empty.
    """
    return _rank(crop_bgr, top_n or config.TOP_N_MATCHES)[1]


def identify_with_shortlist(
    crop_bgr: np.ndarray, top_n: int | None = None
) -> tuple[list[int], list[dict]]:
    """Like :func:`identify` but also return the Stage-1 shortlist row ids.

    Used by the evaluation harness to measure Stage-1 recall (did the true card
    survive the pHash shortlist before Stage 2 re-ranked it?).
    """
    return _rank(crop_bgr, top_n or config.TOP_N_MATCHES)


def _rank(crop_bgr: np.ndarray, top_n: int) -> tuple[list[int], list[dict]]:
    """Run both stages. Returns ``(shortlist_ids, ranked_matches)``."""
    _ensure_loaded()
    ids: np.ndarray = _cache["ids"]
    hashes: np.ndarray = _cache["hashes"]
    if ids is None or len(ids) == 0:
        return [], []

    # --- Stage 1: pHash shortlist (recall) ---
    q_variants = hashing.phash_query_variants(crop_bgr)
    distances = hashing.hamming_to_array(q_variants, hashes)
    k = min(config.SHORTLIST_K, len(ids))
    # argpartition is O(n) to find the k smallest; sort just those k.
    shortlist_idx = np.argpartition(distances, k - 1)[:k]
    shortlist_idx = shortlist_idx[np.argsort(distances[shortlist_idx])]
    shortlist_ids = [int(ids[i]) for i in shortlist_idx]
    hamming_by_id = {int(ids[i]): int(distances[i]) for i in shortlist_idx}

    # --- Stage 2: local-feature re-rank (precision) ---
    with index_db.connection() as conn:
        rows = index_db.load_rows(conn, shortlist_ids)

    q_keypoints, q_desc = features.compute_descriptors(crop_bgr)
    q_pts = features.keypoints_to_points(q_keypoints)
    bf = features.make_matcher()

    scored = []
    for rid in shortlist_ids:
        row = rows.get(rid)
        if row is None:
            continue
        c_pts, c_desc = features.deserialize_features(row["kp_pts"], row["descriptors"])
        score, inliers = features.score_match(q_pts, q_desc, c_pts, c_desc, bf)
        scored.append((score, inliers, hamming_by_id[rid], row))

    # Sort by feature score desc; Python's stable sort keeps the Stage-1 hash
    # order for ties (so a zero-feature DB degrades gracefully to pHash ranking).
    scored.sort(key=lambda t: t[0], reverse=True)

    # Margin for the top match: compare it against the best-scoring *different*
    # card (different oracle_id), skipping other printings of the same card. A
    # near-identical sibling printing scoring closely is not ambiguity, so it
    # shouldn't drag the best match's confidence down.
    best_oracle = scored[0][3]["oracle_id"]
    competitor_inliers = 0
    for _s, inl, _h, r in scored[1:]:
        if r["oracle_id"] != best_oracle:
            competitor_inliers = inl
            break

    results = []
    for rank, (score, inliers, hamming, row) in enumerate(scored[:top_n]):
        confident = inliers >= config.MIN_INLIERS
        if rank == 0:
            # The top match must also clearly beat the best *different* card (not a
            # near-tie) to be trusted — this is what cuts most false-confident calls.
            confident = confident and inliers >= config.CONFIDENT_MARGIN * max(competitor_inliers, 1)
        results.append(
            {
                "scryfallId": row["scryfall_id"],
                "name": row["name"],
                "set": row["set_code"],
                "collectorNumber": row["collector_number"],
                "face": row["face"],
                "hammingDistance": hamming,
                "featureScore": score,
                "inliers": inliers,
                "confident": confident,
                "imageUrl": row["image_url"],
                "scryfallUri": row["scryfall_uri"],
            }
        )
    return shortlist_ids, results

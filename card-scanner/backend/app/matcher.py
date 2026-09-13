"""
Card identification: pHash shortlist → OCR-assisted union → local-feature re-rank.

`identify()` / `identify_card()` are the entry points used by the API. The (small)
Stage-1 data lives in an in-memory cache that auto-reloads when the database
changes, so rebuilding the index or running a metadata backfill does not require
restarting the server.

Stage 1 (recall): rank every indexed hash by Hamming distance to the query
(considering 0° and 180°), keep the top ``SHORTLIST_K``.
Stage 1.5 (OCR, optional): read the crop's text (:mod:`app.ocr`), fuzzy-match every
line against the index's name keys and parse the collector line
(:mod:`app.names`). Rows named that way are **added** to the shortlist
(:func:`app.fusion.build_shortlist`) — never used to filter it, so an OCR failure
can only add candidates and the pHash shortlist remains the recall floor.
Stage 2 (precision): match local features against each shortlisted candidate,
validate the homography and score by inlier count; the text evidence is fused into
the final ranking (:func:`app.fusion.fuse`) and into the ``confident`` decision
(:func:`app.fusion.confidence`). The top-N is returned for human review.

Fallback ladder: OCR disabled / models missing / no legible lines / no text
metadata in the index → the pure pHash → ORB path, with exactly the ranking this
module had before OCR existed.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field

import numpy as np

from . import config, features, fusion, hashing, index_db, names, ocr

# Module-level cache of the Stage-1 data. Guarded by a lock because FastAPI may
# serve requests concurrently. `sig` is the DB change-token last loaded;
# `checked_at` debounces how often we hit the DB to re-check it. `ids`/`hashes`
# are the brute-force arrays; `stage1` is the full :class:`index_db.Stage1Data`
# (None when the cache was primed some other way, e.g. by tests) and `names` the
# text lookup table built from it (None until the metadata backfill has run).
_lock = threading.Lock()
_EMPTY = (np.empty(0, np.int64), np.empty(0, np.uint64))
_cache: dict = {"sig": None, "checked_at": 0.0, "ids": None, "hashes": None}

# LRU of deserialised features for recently scored rows: row id -> (row dict
# without blobs, keypoints (N,2), descriptors). Cleared whenever the index changes.
_feature_cache: OrderedDict[int, tuple[dict, np.ndarray | None, np.ndarray | None]] = OrderedDict()


def _build_name_table(stage1: index_db.Stage1Data | None) -> names.NameTable | None:
    """The OCR lookup table for this index, or None when the metadata is absent."""
    if stage1 is None or not any(k is not None for k in stage1.name_key):
        return None
    rows = (
        (
            i,
            stage1.name_key[i],
            stage1.face_name_keys[i],
            stage1.set_code[i],
            stage1.cn_norm[i],
            stage1.cn_base[i],
        )
        for i in range(len(stage1.ids))
        if stage1.name_key[i] is not None
    )
    return names.NameTable.from_rows(rows)


def _ensure_loaded() -> None:
    """(Re)load the Stage-1 data when the DB's change-signature differs.

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
        if (
            _cache["ids"] is not None
            and (now - _cache["checked_at"]) < config.INDEX_REFRESH_SECONDS
        ):
            return
        try:
            with index_db.connection() as conn:
                sig = index_db.index_signature(conn)
                if _cache["ids"] is None or sig != _cache["sig"]:
                    stage1 = index_db.load_stage1(conn)
                    _cache.update(
                        sig=sig,
                        ids=stage1.ids,
                        hashes=stage1.hashes,
                        stage1=stage1,
                        names=_build_name_table(stage1),
                    )
                    # Row ids may have been reassigned by a rebuild: drop cached features.
                    _feature_cache.clear()
            _cache["checked_at"] = time.monotonic()
        except Exception as err:
            # DB unavailable / not yet initialized must never 500 the API.
            print(f"index load failed: {err}", flush=True)
            _cache.update(
                sig=None,
                ids=_EMPTY[0],
                hashes=_EMPTY[1],
                stage1=None,
                names=None,
                checked_at=time.monotonic(),
            )


def index_size() -> int:
    """Number of indexed card faces currently loaded."""
    _ensure_loaded()
    return int(len(_cache["ids"]))


def text_metadata_available() -> bool:
    """Whether the loaded index carries the OCR name/collector tables."""
    _ensure_loaded()
    return _cache.get("names") is not None


def nearest_hash_distance(crop_bgr: np.ndarray) -> tuple[int, int] | None:
    """Stage 1 only: ``(min Hamming over the index, winning variant)``.

    The variant is 0 for the crop as-is and 180 for its rotation. Used by the
    detector to verify that a candidate quad looks like *some* card and to learn
    its orientation, at ~1 ms per call. ``None`` when the index is empty.
    """
    _ensure_loaded()
    hashes: np.ndarray = _cache["hashes"]
    if hashes is None or len(hashes) == 0:
        return None
    best: tuple[int, int] | None = None
    for variant, q in zip((0, 180), hashing.phash_query_variants(crop_bgr), strict=True):
        d = int(hashing.hamming_to_array([q], hashes).min())
        if best is None or d < best[0]:
            best = (d, variant)
    return best


@dataclass
class IdentifyResult:
    """Everything a caller may want from one identification.

    ``matches`` is the ranked top-N (what :func:`identify` returns); ``orientation``
    is the crop's upright orientation (0 / 180) when the evidence is decisive —
    the validated homography of the winning match first, then the OCR line
    classifier's vote — else ``None``; ``ocr`` is a JSON-ready summary of the OCR
    stage (``None`` when OCR did not run); ``timings_ms`` per stage.
    """

    matches: list[dict]
    shortlist_ids: list[int] = field(default_factory=list)
    orientation: int | None = None
    ocr: dict | None = None
    timings_ms: dict[str, float] = field(default_factory=dict)
    # Shortlist sources per row id ("hash" / "name" / "cn"), for the harnesses.
    shortlist_sources: dict[int, list[str]] = field(default_factory=dict)


def identify(
    crop_bgr: np.ndarray, top_n: int | None = None, *, ocr_image: np.ndarray | None = None
) -> list[dict]:
    """Identify a de-skewed card crop against the index.

    Args:
        crop_bgr: A normalised card crop (BGR) from Part 1.
        top_n: How many ranked candidates to return (default from config).
        ocr_image: Optional higher-resolution warp of the same card for the OCR
            band passes (see :meth:`app.ocr.OcrEngine.read_card`).

    Returns:
        A list (best first) of match dicts; empty if the index is empty.
    """
    return identify_card(crop_bgr, top_n, ocr_image=ocr_image).matches


def identify_with_shortlist(
    crop_bgr: np.ndarray, top_n: int | None = None, *, ocr_image: np.ndarray | None = None
) -> tuple[list[int], list[dict]]:
    """Like :func:`identify` but also return the shortlist row ids.

    Used by the evaluation harnesses to measure Stage-1 recall (did the true card
    survive the shortlist before Stage 2 re-ranked it?).
    """
    res = identify_card(crop_bgr, top_n, ocr_image=ocr_image)
    return res.shortlist_ids, res.matches


def identify_card(
    crop_bgr: np.ndarray, top_n: int | None = None, *, ocr_image: np.ndarray | None = None
) -> IdentifyResult:
    """Identify a crop and return the full :class:`IdentifyResult` (see :func:`identify`)."""
    return _rank(crop_bgr, top_n or config.TOP_N_MATCHES, ocr_image=ocr_image)


# --- internals ------------------------------------------------------------------


def _load_features(
    shortlist_ids: list[int],
) -> dict[int, tuple[dict, np.ndarray | None, np.ndarray | None]]:
    """Rows + deserialised features for the shortlist, via the LRU where possible."""
    out: dict[int, tuple[dict, np.ndarray | None, np.ndarray | None]] = {}
    missing = []
    for rid in shortlist_ids:
        entry = _feature_cache.get(rid)
        if entry is not None:
            _feature_cache.move_to_end(rid)
            out[rid] = entry
        else:
            missing.append(rid)
    if missing:
        with index_db.connection() as conn:
            rows = index_db.load_rows(conn, missing)
        for rid, row in rows.items():
            pts, desc = features.deserialize_features(row.get("kp_pts"), row.get("descriptors"))
            meta = {k: v for k, v in row.items() if k not in ("kp_pts", "descriptors")}
            entry = (meta, pts, desc)
            out[rid] = entry
            _feature_cache[rid] = entry
        while len(_feature_cache) > config.DESC_CACHE_ROWS:
            _feature_cache.popitem(last=False)
    return out


def _stage1(crop_bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """pHash scan: ``(row positions of the top-K by distance, distances for every row)``."""
    hashes: np.ndarray = _cache["hashes"]
    query = hashing.mask_glare(crop_bgr) if config.QUERY_GLARE_MASK else crop_bgr
    q_variants = hashing.phash_query_variants(query)
    distances = hashing.hamming_to_array(q_variants, hashes)
    k = min(config.SHORTLIST_K, len(hashes))
    # argpartition is O(n) to find the k smallest; sort just those k.
    idx = np.argpartition(distances, k - 1)[:k]
    idx = idx[np.argsort(distances[idx], kind="stable")]
    return idx, distances


def _run_ocr(
    crop_bgr: np.ndarray, ocr_image: np.ndarray | None, table: names.NameTable | None
) -> tuple[ocr.OcrResult | None, list[names.NameHit], names.CollectorHit | None, np.ndarray | None]:
    """OCR the crop and turn its lines into name hits and collector rows.

    Returns ``(ocr_result, name_hits, collector_hit, collector_rows)``; every part
    degrades to empty when OCR is unavailable or the index has no text metadata.
    """
    engine = ocr.get_engine()
    if engine is None:
        return None, [], None, None
    # Full-crop pass first; the (slower) band passes only when it did not yield a
    # collector line — on most modern cards it does, so the bands are usually skipped.
    lazy = config.OCR_BANDS_LAZY and engine.band_passes
    result = engine.read_card(crop_bgr, ocr_image, band_passes=False if lazy else None)
    if result is None or table is None:
        return result, [], None, None
    cn_hit = names.parse_collector_line(result.texts, table.set_codes) if result.lines else None
    if lazy and cn_hit is None:
        engine.read_bands(crop_bgr, ocr_image, into=result)
        cn_hit = names.parse_collector_line(result.texts, table.set_codes) if result.lines else None
    if not result.lines:
        return result, [], None, None

    lines = result.texts
    hits = names.match_names(
        lines,
        table,
        min_score=config.NAME_MIN_SCORE,
        short_len=config.NAME_SHORT_LEN,
        mid_len=config.NAME_MID_LEN,
        mid_score=config.NAME_MID_SCORE,
        top_m=config.NAME_TOP_M,
        ambiguity_gap=config.NAME_AMBIGUITY_GAP,
        partial_min_len=config.NAME_PARTIAL_MIN_LEN,
        partial_min_score=config.NAME_PARTIAL_MIN_SCORE,
        partial_min_coverage=config.NAME_PARTIAL_MIN_COVERAGE,
    )
    cn_rows = None
    if cn_hit is not None:
        name_rows = None
        if hits:
            name_rows = np.unique(
                np.concatenate([table.rows_by_key.get(h.key, np.empty(0, np.int64)) for h in hits])
            )
        cn_rows = names.lookup_collector(cn_hit, table, name_rows)
    return result, hits, cn_hit, cn_rows


def _ocr_summary(
    result: ocr.OcrResult | None, hits: list[names.NameHit], cn_hit: names.CollectorHit | None
) -> dict | None:
    """JSON-ready description of what OCR saw (for the API response and harnesses)."""
    if result is None:
        return None
    summary: dict = {
        "name": {"key": hits[0].key, "score": hits[0].score, "text": hits[0].line_text}
        if hits
        else None,
        "candidates": [{"key": h.key, "score": h.score} for h in hits[1:]],
        "collector": (
            {
                "set": cn_hit.set_code,
                "number": cn_hit.number,
                "lang": cn_hit.lang,
                "rarity": cn_hit.rarity,
            }
            if cn_hit
            else None
        ),
        "orientation": result.best_orientation(),
        "elapsedMs": {k: round(v, 1) for k, v in result.elapsed_ms.items()},
    }
    if config.OCR_LINES_IN_RESPONSE:
        summary["lines"] = [
            {"text": line.text, "conf": round(line.conf, 3), "source": line.source}
            for line in result.lines
        ]
    return summary


def _rank(
    crop_bgr: np.ndarray, top_n: int, *, ocr_image: np.ndarray | None = None
) -> IdentifyResult:
    """Run every stage and assemble the :class:`IdentifyResult`."""
    timings: dict[str, float] = {}
    t_start = time.perf_counter()
    _ensure_loaded()
    ids: np.ndarray = _cache["ids"]
    if ids is None or len(ids) == 0:
        return IdentifyResult(matches=[])
    stage1: index_db.Stage1Data | None = _cache.get("stage1")
    table: names.NameTable | None = _cache.get("names")

    # --- Stage 1: pHash shortlist (recall) ---
    t0 = time.perf_counter()
    hash_ranked, distances = _stage1(crop_bgr)
    timings["stage1"] = (time.perf_counter() - t0) * 1000

    # --- Stage 1.5: OCR → names / collector line → union shortlist ---
    t0 = time.perf_counter()
    ocr_result, name_hits, cn_hit, cn_rows = _run_ocr(crop_bgr, ocr_image, table)
    if table is not None and (name_hits or cn_rows is not None):
        entries = fusion.build_shortlist(
            hash_ranked,
            distances,
            name_hits,
            table,
            cn_rows,
            name_max_rows=config.NAME_MAX_ROWS,
            shortlist_max=config.SHORTLIST_MAX,
        )
    else:
        entries = [fusion.ShortlistEntry(int(pos), {fusion.SOURCE_HASH}) for pos in hash_ranked]
    timings["ocr"] = (time.perf_counter() - t0) * 1000
    shortlist_ids = [int(ids[e.row]) for e in entries]
    sources_by_id = {int(ids[e.row]): sorted(e.sources) for e in entries}

    # --- Stage 2: local-feature re-rank (precision) ---
    t0 = time.perf_counter()
    rows = _load_features(shortlist_ids)
    q_keypoints, q_desc = features.compute_descriptors(crop_bgr)
    q_pts = features.keypoints_to_points(q_keypoints)
    bf = features.make_matcher()
    size = (crop_bgr.shape[1], crop_bgr.shape[0])

    scored: list[tuple[fusion.Scored, features.MatchResult, dict]] = []
    best_by_oracle: dict[str | None, int] = {}
    for n, entry in enumerate(entries, start=1):
        rid = int(ids[entry.row])
        loaded = rows.get(rid)
        if loaded is None:
            continue
        meta, c_pts, c_desc = loaded
        res = features.score_match_ex(q_pts, q_desc, c_pts, c_desc, bf, size=size)
        pos = entry.row
        scored.append(
            (
                fusion.Scored(
                    row=pos,
                    inliers_valid=res.inliers,
                    hamming=int(distances[pos]),
                    name_key=(stage1.name_key[pos] if stage1 else meta.get("name_key")),
                    face_name_keys=list(
                        (stage1.face_name_keys[pos] if stage1 else meta.get("face_name_keys")) or ()
                    ),
                    set_code=meta.get("set_code"),
                    cn_norm=(stage1.cn_norm[pos] if stage1 else meta.get("collector_number_norm")),
                    cn_base=(stage1.cn_base[pos] if stage1 else meta.get("collector_number_base")),
                    oracle_id=meta.get("oracle_id"),
                    sources=set(entry.sources),
                    border_color=meta.get("border_color"),
                ),
                res,
                meta,
            )
        )
        oracle = meta.get("oracle_id")
        best_by_oracle[oracle] = max(best_by_oracle.get(oracle, 0), res.inliers)
        # Early exit: a decisive leader whose sibling printings are all scored.
        if n % config.EARLY_EXIT_CHUNK == 0 and _decisive(
            best_by_oracle, [int(ids[e.row]) for e in entries[n:]], rows
        ):
            break
    timings["stage2"] = (time.perf_counter() - t0) * 1000

    # Every shortlisted id can be missing from `rows`: a set is wiped and rebuilt
    # inside one transaction (see build_index.index_all_english), but the cached
    # hash table keeps the old row ids until the next refresh, so for a few
    # seconds Stage 2 may find nothing to score. That is "no match", not a 500.
    if not scored:
        return IdentifyResult(
            matches=[],
            shortlist_ids=shortlist_ids,
            ocr=_ocr_summary(ocr_result, name_hits, cn_hit),
            timings_ms=timings,
            shortlist_sources=sources_by_id,
        )

    # --- Fusion + confidence ---
    by_row = {s.row: (res, meta) for s, res, meta in scored}
    crop_border = fusion.classify_border(crop_bgr)
    ranked = fusion.fuse(
        [s for s, _r, _m in scored],
        name_hits,
        cn_hit,
        name_w=config.FUSION_NAME_W,
        cn_w=config.FUSION_CN_W,
        hash_w=config.FUSION_HASH_W,
        min_score=config.NAME_MIN_SCORE,
        crop_border=crop_border,
        border_w=config.FUSION_BORDER_W,
    )
    # A collector line naming a sibling printing of the leader picks the printing.
    ranked = fusion.promote_collector_match(ranked, cn_hit, min_inliers=config.MIN_INLIERS_WITH_CN)
    flags = fusion.confidence(
        ranked,
        name_hits,
        cn_hit,
        min_inliers=config.MIN_INLIERS,
        margin=config.CONFIDENT_MARGIN,
        name_confident_score=config.NAME_CONFIDENT_SCORE,
        min_inliers_with_name=config.MIN_INLIERS_WITH_NAME,
        min_inliers_with_cn=config.MIN_INLIERS_WITH_CN,
        ambiguity_gap=config.NAME_AMBIGUITY_GAP,
        veto_score=config.VETO_SCORE,
    )

    results = []
    for fused, (confident, rule) in zip(ranked[:top_n], flags[:top_n], strict=True):
        res, meta = by_row[fused.entry.row]
        keys = fused.entry.keys
        best_hit = next((h for h in name_hits if h.key in keys), None)
        results.append(
            {
                "scryfallId": meta["scryfall_id"],
                "name": meta["name"],
                "set": meta["set_code"],
                "collectorNumber": meta["collector_number"],
                "face": meta["face"],
                "hammingDistance": fused.entry.hamming,
                "featureScore": res.score,
                "inliers": res.inliers,
                "goodMatches": res.good,
                "confident": confident,
                "confidenceRule": rule,
                "fusedScore": round(fused.fused, 3),
                "nameMatch": ({"key": best_hit.key, "score": best_hit.score} if best_hit else None),
                "collectorMatch": (
                    {"set": cn_hit.set_code, "number": cn_hit.number, "lang": cn_hit.lang}
                    if cn_hit is not None and fused.cn_bonus > 0
                    else None
                ),
                "shortlistSources": sorted(fused.entry.sources),
                "rotation": _nearest_axis(res.rotation),
                "imageUrl": meta["image_url"],
                "scryfallUri": meta["scryfall_uri"],
            }
        )

    # Orientation: the winner's validated homography is the strongest witness; the
    # OCR line classifier's vote is the fallback.
    orientation = results[0]["rotation"] if results else None
    if orientation is None and ocr_result is not None:
        orientation = ocr_result.best_orientation()
    timings["total"] = (time.perf_counter() - t_start) * 1000
    return IdentifyResult(
        matches=results,
        shortlist_ids=shortlist_ids,
        orientation=orientation,
        ocr=_ocr_summary(ocr_result, name_hits, cn_hit),
        timings_ms=timings,
        shortlist_sources=sources_by_id,
    )


def _nearest_axis(rotation: float | None) -> int | None:
    """Snap a validated homography rotation to 0 or 180 (None without a fit)."""
    if rotation is None:
        return None
    return 180 if abs(rotation - 180.0) < 90.0 else 0


def _decisive(best_by_oracle: dict[str | None, int], remaining_ids: list[int], rows: dict) -> bool:
    """Early-exit test: leader ≥ EARLY_EXIT_INLIERS, ≥ margin × runner-up oracle, siblings done."""
    if not best_by_oracle:
        return False
    ranked = sorted(best_by_oracle.items(), key=lambda kv: kv[1], reverse=True)
    leader_oracle, leader = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0
    if leader < config.EARLY_EXIT_INLIERS or leader < config.EARLY_EXIT_MARGIN * max(runner_up, 1):
        return False
    # Don't stop while a sibling printing of the leader is still unscored: the
    # user picks the printing from the top-N, so the siblings must be ranked too.
    return not any(
        rows.get(rid) is not None and rows[rid][0].get("oracle_id") == leader_oracle
        for rid in remaining_ids
    )

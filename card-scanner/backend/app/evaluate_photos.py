"""
Real-photo accuracy harness: runs the actual pipeline on labelled photos.

Where :mod:`app.evaluate` measures identification by self-retrieval of
synthetically distorted Scryfall images, this harness runs **detection and
identification on real photos** against the hand-authored manifest
(``test-images.json``, see :mod:`app.labels`). It is the measurement that every
detector / matcher change is judged by.

Usage (from ``card-scanner/backend``)::

    python -m app.evaluate_photos ../test-images
    python -m app.evaluate_photos ../test-images --detection-only \\
        --json ../benchmarks/real-photos.detection.json
    python -m app.evaluate_photos ../test-images --detection-only \\
        --baseline ../benchmarks/real-photos.detection.json      # exit 2 on regression
    python -m app.evaluate_photos ../test-images ../data/synth-regression \\
        --overlay-dir ../test-images/_overlays --csv /tmp/photos.csv

``DATASET`` is any directory holding a ``test-images.json`` (several may be
given). Entries with ``kind: crop`` are already de-skewed cards and skip
detection.

What is measured
----------------
*Detection* (entries whose cards carry ``quad`` labels; ``--include-drafts``
also admits ``quadSource: draft``): recall and precision at IoU ≥ ``--iou``
(greedy one-to-one, :func:`app.geometry.match_quads`), false positives per
photo, and corner error of true positives in px and as a percentage of the
card's short side (mean / median / p95). Every entry, labelled or not, also
contributes a weak *count check* (detected == listed).

*Identification* (per ground-truth card that has a crop to identify — a
detection true positive, or its own warp with ``--gt-crops``): top-1 and
top-N printing correctness in three tiers — ``strict`` (exact Scryfall id),
``family`` (same base collector number in the set or its promo twin, so the prerelease ``150s``
twin of ``0150`` counts) and ``lenient`` (same oracle id) — plus Stage-1
shortlist recall and false-"confident" calls. Entries **without quads** are
still scored: expected identities are matched to the detected crops' top-1
results as a set (strict first, then lenient, then within top-N), so they
measure "did every listed card come out of the photo" without saying which
quad was which.

``--baseline REPORT.json`` diffs the run against a committed report and exits
2 when detection regresses beyond ``--tolerance`` (and identification too with
``--gate-identification``). Exit 1 means the dataset or the index could not be
used.
"""

from __future__ import annotations

import argparse
import csv
import json
import platform
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np

from . import config, detection, geometry, labels

SCHEMA = "card-scanner.evaluate-photos/1"
OVERLAY_WIDTH = 1600

# Config values worth snapshotting into a report (no secrets: DATABASE_URL is
# deliberately absent). Anything that changes detection or matching behaviour.
_CONFIG_KEYS = (
    "WORK_LONG_EDGE",
    "MIN_AREA_RATIO",
    "MAX_AREA_RATIO",
    "APPROX_EPSILON_RATIO",
    "CANNY_LOW",
    "CANNY_HIGH",
    "OUTPUT_HEIGHT",
    "OUTPUT_WIDTH",
    "PHASH_SIZE",
    "PHASH_HIGHFREQ_FACTOR",
    "SHORTLIST_K",
    "FEATURE_DETECTOR",
    "ORB_FEATURES",
    "SIFT_FEATURES",
    "RATIO_TEST",
    "MIN_GOOD_MATCHES",
    "MIN_INLIERS",
    "CONFIDENT_MARGIN",
    "TOP_N_MATCHES",
    # detection rewrite
    "DETECT_STRATEGIES",
    "CANNY_MODE",
    "WORK_LONG_EDGES",
    "MIN_SIDE_PX",
    "NMS_IOU",
    "NMS_CONTAINMENT",
    "NMS_CONSENSUS_HITS",
    "VERIFY_MODE",
    "VERIFY_MAX_HAMMING",
    "VERIFY_AMBIGUOUS_HAMMING",
    "VERIFY_MIN_INDEX_SIZE",
    "SPLIT_TOUCHING",
    "REFINE_CORNERS",
    # OCR / fusion
    "OCR_ENABLED",
    "OCR_MAX_LINES",
    "OCR_MIN_CONF",
    "OCR_BANDS_LAZY",
    "NAME_MIN_SCORE",
    "NAME_MAX_ROWS",
    "SHORTLIST_MAX",
    "FUSION_NAME_W",
    "FUSION_CN_W",
    "FUSION_BORDER_W",
    "HOMOGRAPHY_VALIDATE",
)


# --------------------------------------------------------------------------
# Options
# --------------------------------------------------------------------------


class Options:
    """Plain bag of run options (kept explicit so the report can embed them)."""

    def __init__(
        self,
        *,
        detection_only: bool = False,
        gt_crops: bool = False,
        iou: float = 0.7,
        top_n: int = 5,
        tag: str | None = None,
        include_drafts: bool = False,
        seed: int = 0,
    ) -> None:
        self.detection_only = detection_only
        self.gt_crops = gt_crops
        self.iou = iou
        self.top_n = top_n
        self.tag = tag
        self.include_drafts = include_drafts
        self.seed = seed

    def to_dict(self) -> dict:
        return dict(vars(self))


# --------------------------------------------------------------------------
# Per-photo evaluation
# --------------------------------------------------------------------------


def _normalize_crop(image_bgr: np.ndarray) -> np.ndarray:
    """Rotate a raw crop to portrait and resize to the matcher's expected size.

    Mirrors ``detection._normalize_to_card`` (landscape → 90° clockwise) so a
    ``kind: crop`` file or a ``--gt-crops`` warp is fed to the matcher exactly
    like a live detection would be.
    """
    h, w = image_bgr.shape[:2]
    if w > h:
        image_bgr = cv2.rotate(image_bgr, cv2.ROTATE_90_CLOCKWISE)
    return cv2.resize(
        image_bgr, (config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT), interpolation=cv2.INTER_AREA
    )


def _usable_quad(card: dict, include_drafts: bool) -> np.ndarray | None:
    """The card's quad if it is verified (or a draft and drafts are allowed)."""
    quad = labels.card_quad(card)
    if quad is None:
        return None
    source = card.get("quadSource")
    if source == "verified" or (include_drafts and source == "draft"):
        return quad
    return None


def _resolution_dict(res: labels.Resolution) -> dict:
    return {
        "scryfall_id": res.scryfall_id,
        "oracle_id": res.oracle_id,
        "how": res.how,
        "warning": res.warning,
        "set_code": res.set_code,
        "collector_number": res.collector_number,
        "name": res.name,
    }


def _slim_match(m: dict | None) -> dict | None:
    """The fields of a matcher result worth keeping in the report."""
    if m is None:
        return None
    return {
        "scryfallId": m["scryfallId"],
        "name": m["name"],
        "set": m["set"],
        "collectorNumber": m["collectorNumber"],
        "face": m.get("face"),
        "hammingDistance": m.get("hammingDistance"),
        "inliers": m.get("inliers"),
        "confident": bool(m.get("confident")),
    }


def _tier_ranks(
    results: list[dict], res: labels.Resolution, maps: labels.IndexMaps | None
) -> dict[str, int | None]:
    """0-based rank of the first result that is correct in each tier (or None)."""
    ranks: dict[str, int | None] = {"strict": None, "family": None, "lenient": None}
    if not res.resolved:
        return ranks
    exp_set = labels.normalize_set(res.set_code)
    exp_base = labels.base_number(res.collector_number)
    for i, m in enumerate(results):
        if ranks["strict"] is None and m["scryfallId"] == res.scryfall_id:
            ranks["strict"] = i
        if (
            ranks["family"] is None
            and labels.normalize_set(m["set"])
            in (exp_set, "p" + exp_set, exp_set[1:] if exp_set.startswith("p") else "\0")
            and labels.base_number(m["collectorNumber"]) == exp_base
        ):
            # Same base number in the set or its promo twin ("ptla" for "tla"): a
            # prerelease stamp is the only physical difference.
            ranks["family"] = i
        if (
            ranks["lenient"] is None
            and maps is not None
            and res.oracle_id is not None
            and maps.oracle_of(m["scryfallId"]) == res.oracle_id
        ):
            ranks["lenient"] = i
    return ranks


def _identify(crop: np.ndarray, opts: Options) -> tuple[list[int], list[dict], float, object]:
    """Seeded identification; returns ``(shortlist_ids, results, elapsed_ms, IdentifyResult)``."""
    from . import matcher

    cv2.setRNGSeed(opts.seed)  # RANSAC is randomised; pin it for reproducible reports
    t0 = time.perf_counter()
    ident = matcher.identify_card(crop, opts.top_n)
    ms = (time.perf_counter() - t0) * 1000.0
    return ident.shortlist_ids, ident.matches, ms, ident


def _record_ocr(gt: dict, card: dict, ident) -> None:
    """Copy the OCR stage's verdicts onto the GT row and score them.

    The printed name is what OCR sees, so ``flavorName`` / ``name-en`` take
    precedence over Scryfall's ``name``; the collector read is correct when its
    normalised number matches the manifest's ``number`` (and, when the read
    carries a set code, the set too).
    """
    from . import names

    summary = getattr(ident, "ocr", None)
    if not summary:
        return
    gt["ocr_ran"] = True
    name_hit = summary.get("name") or {}
    gt["ocr_name"] = name_hit.get("key")
    printed = card.get("flavorName") or card.get("name-en") or card.get("name") or ""
    expected_keys = {names.normalize_key(printed), names.normalize_key(card.get("name") or "")}
    expected_keys.discard("")
    if gt["ocr_name"] is not None:
        gt["ocr_name_ok"] = gt["ocr_name"] in expected_keys
    coll = summary.get("collector")
    if coll:
        gt["ocr_collector"] = f"{coll.get('set') or '?'}:{coll.get('number')}"
        number_ok = card.get("number") is not None and (
            names.normalize_collector_number(str(card["number"]))[0] == coll.get("number")
        )
        set_ok = coll.get("set") is None or str(card.get("set", "")).lower() == coll.get("set")
        gt["ocr_collector_ok"] = bool(number_ok and set_ok)


def _identity_match(
    free_gt: list[int],
    free_det: list[int],
    gt_rows: list[dict],
    det_rows: list[dict],
    resolutions: list[labels.Resolution],
    maps: labels.IndexMaps,
) -> None:
    """Set-match GT identities to detections' results (quad-less entries).

    Passes, in order: strict top-1, lenient top-1, strict within top-N, lenient
    within top-N. A matched GT records the detection and the rank at which it
    matched; both lists are mutated in place.
    """
    passes = (("strict", 0), ("lenient", 0), ("strict", None), ("lenient", None))
    for tier, only_rank in passes:
        for gi in list(free_gt):
            res = resolutions[gi]
            if not res.resolved:
                continue
            for di in list(free_det):
                results = det_rows[di]["results"]
                ranks = _tier_ranks(results, res, maps)
                rank = ranks[tier]
                if rank is None or (only_rank is not None and rank != only_rank):
                    continue
                gt = gt_rows[gi]
                gt.update(
                    det_index=di,
                    match_how="identity",
                    strict_rank=ranks["strict"],
                    family_rank=ranks["family"],
                    lenient_rank=ranks["lenient"],
                )
                det_rows[di]["gt_index"] = gi
                free_gt.remove(gi)
                free_det.remove(di)
                break


def evaluate_entry(entry: dict, root: Path, maps: labels.IndexMaps | None, opts: Options) -> dict:
    """Run the pipeline on one manifest entry and return its per-photo result dict."""
    kind = labels.entry_kind(entry)
    image = detection.load_image_bgr((root / entry["fileName"]).read_bytes())
    cards = entry.get("cards", [])
    identify = not opts.detection_only and maps is not None

    # --- ground truth rows -------------------------------------------------
    # Without an index (detection-only) labels are simply not resolved — that is
    # not a labelling problem, so it gets its own ``how`` and no warning.
    resolutions = [
        labels.resolve_expected(c, maps)
        if maps is not None
        else labels.Resolution(None, None, None, "not-resolved", None)
        for c in cards
    ]
    gt_rows: list[dict] = []
    for i, (card, res) in enumerate(zip(cards, resolutions, strict=True)):
        quad = _usable_quad(card, opts.include_drafts) if kind == "photo" else None
        gt_rows.append(
            {
                "index": i,
                "name": card.get("name"),
                "set": card.get("set"),
                "number": card.get("number"),
                "resolved": _resolution_dict(res),
                "has_quad": quad is not None,
                "quad": labels.quad_to_json(quad) if quad is not None else None,
                "quad_source": card.get("quadSource"),
                "orientation": labels.orientation_of(quad) if quad is not None else None,
                "det_index": None,
                "match_how": None,
                "iou": None,
                "corner_err_px": None,
                "corner_err_pct": None,
                "top1": None,
                "strict_rank": None,
                "family_rank": None,
                "lenient_rank": None,
                "stage1_hit": None,
                "stage1_hit_hash": None,
                "false_confident": False,
                "id_evaluated": False,
                "ocr_ran": False,
                "ocr_name": None,
                "ocr_name_ok": None,
                "ocr_collector": None,
                "ocr_collector_ok": None,
            }
        )

    # --- detection ------------------------------------------------------------
    t0 = time.perf_counter()
    dets: list = []
    if kind == "crop":
        h, w = image.shape[:2]
        crops = [_normalize_crop(image)]
        det_quads = [np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)]
    else:
        dets = detection.detect_and_deskew(image)
        crops = [d.image for d in dets]
        det_quads = [geometry.order_points(d.quad) for d in dets]
    detect_ms = (time.perf_counter() - t0) * 1000.0

    det_rows: list[dict] = [
        {
            "index": i,
            "quad": labels.quad_to_json(q),
            "gt_index": None,
            "results": [],
            "shortlist": [],
            "identify_ms": None,
            "ident": None,
        }
        for i, q in enumerate(det_quads)
    ]
    if identify:
        from . import verify

        for row, crop in zip(det_rows, crops, strict=True):
            shortlist, results, ms, ident = _identify(crop, opts)
            row.update(results=results, shortlist=shortlist, identify_ms=ms, ident=ident)
        # Mirror the API: detections that fail the Stage-2 gate never reach the user,
        # so they count neither as detections nor as false positives here.
        if kind != "crop":
            keep = [
                i
                for i, (row, det) in enumerate(zip(det_rows, dets, strict=True))
                if verify.orb_gate(det, row["results"])
            ]
            det_rows = [det_rows[i] for i in keep]
            det_quads = [det_quads[i] for i in keep]
            crops = [crops[i] for i in keep]
            for new_index, row in enumerate(det_rows):
                row["index"] = new_index

    # --- matching: IoU for labelled quads, identity for the rest ------------------
    labelled = [g["index"] for g in gt_rows if g["has_quad"]]
    gt_quads = [labels.card_quad(cards[i]) for i in labelled]
    matches, unmatched_pred, unmatched_gt = geometry.match_quads(det_quads, gt_quads, opts.iou)
    for di, gj, iou in matches:
        gi = labelled[gj]
        gt = gt_rows[gi]
        gq = gt_quads[gj]
        err_px = geometry.corner_error(det_quads[di], gq)
        short_side = min(*geometry.warp_size(gq))
        gt.update(
            det_index=di,
            match_how="iou",
            iou=round(iou, 4),
            corner_err_px=round(err_px, 2),
            corner_err_pct=round(100.0 * err_px / max(short_side, 1), 3),
        )
        det_rows[di]["gt_index"] = gi

    free_gt = [g["index"] for g in gt_rows if not g["has_quad"]]
    free_det = list(unmatched_pred)
    if identify and free_gt:
        _identity_match(free_gt, free_det, gt_rows, det_rows, resolutions, maps)

    # Only an entry whose every card is quad-labelled can call a leftover
    # detection a false positive; elsewhere it may simply be an unlabelled card.
    fully_labelled = kind == "photo" and bool(cards) and len(labelled) == len(cards)
    for di in free_det:
        det_rows[di]["is_fp"] = fully_labelled
    for row in det_rows:
        row.setdefault("is_fp", False)

    # --- identification scoring ----------------------------------------------------
    if identify:
        for gt, res in zip(gt_rows, resolutions, strict=True):
            crop = None
            results: list[dict] = []
            shortlist: list[int] = []
            ident = None
            if opts.gt_crops and gt["has_quad"]:
                # Identify the labelled quad itself, independent of the detector.
                quad = labels.card_quad(cards[gt["index"]])
                w, h = geometry.warp_size(quad)
                crop = _normalize_crop(geometry.warp_ordered_quad(image, quad, w, h))
                shortlist, results, ms, ident = _identify(crop, opts)
                gt["gt_crop_identify_ms"] = ms
            elif gt["det_index"] is not None:
                det = det_rows[gt["det_index"]]
                results, shortlist, ident = det["results"], det["shortlist"], det["ident"]
            elif kind == "crop" and det_rows:
                det = det_rows[0]
                results, shortlist, ident = det["results"], det["shortlist"], det["ident"]
                gt["det_index"], det["gt_index"] = 0, gt["index"]
            else:
                continue  # not detected → nothing to identify (FN already counted)
            _record_ocr(gt, cards[gt["index"]], ident)

            gt["id_evaluated"] = True
            ranks = _tier_ranks(results, res, maps)
            gt.update(
                top1=_slim_match(results[0] if results else None),
                strict_rank=ranks["strict"],
                family_rank=ranks["family"],
                lenient_rank=ranks["lenient"],
            )
            if res.resolved:
                true_ids = {r.row_id for r in maps.by_scryfall_id.get(res.scryfall_id, [])}
                gt["stage1_hit"] = bool(true_ids & set(shortlist))
                sources = getattr(ident, "shortlist_sources", {}) or {}
                # Would the pHash top-K alone have kept the true card? (The union
                # shortlist may have rescued it via a name / collector read.)
                gt["stage1_hit_hash"] = any("hash" in sources.get(rid, []) for rid in true_ids)
            best = results[0] if results else None
            gt["false_confident"] = bool(best and best["confident"] and ranks["lenient"] != 0)

        # A quad-less GT that no detection's results could be matched to counts as
        # evaluated-and-missed: the card was listed but never came out of the photo.
        for gt in gt_rows:
            if not gt["has_quad"] and kind == "photo" and gt["det_index"] is None:
                gt["id_evaluated"] = True

    detections_out = [
        {
            "index": d["index"],
            "quad": d["quad"],
            "gt_index": d["gt_index"],
            "is_fp": d["is_fp"],
            "top1": _slim_match(d["results"][0] if d["results"] else None),
            "identify_ms": None if d["identify_ms"] is None else round(d["identify_ms"], 1),
        }
        for d in det_rows
    ]
    return {
        "dataset": str(root),
        "fileName": entry["fileName"],
        "kind": kind,
        "background": labels.entry_background(entry),
        "tags": list(entry.get("tags") or []),
        "frame": [int(image.shape[1]), int(image.shape[0])],
        "n_gt": len(cards),
        "n_gt_quads": len(labelled),
        "fully_labelled": fully_labelled,
        "n_detected": len(det_rows),
        "count_ok": len(det_rows) == len(cards),
        "det_tp": len(matches),
        "det_fn": len(unmatched_gt),
        "det_fp": sum(1 for d in det_rows if d["is_fp"]),
        "unmatched_detections": len(free_det),
        "detect_ms": round(detect_ms, 1),
        "gt": gt_rows,
        "detections": detections_out,
    }


# --------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------


def _pctl(values: list[float]) -> dict:
    if not values:
        return {"n": 0, "mean": None, "median": None, "p95": None, "max": None}
    arr = np.asarray(values, dtype=np.float64)
    return {
        "n": int(arr.size),
        "mean": round(float(arr.mean()), 3),
        "median": round(float(np.median(arr)), 3),
        "p95": round(float(np.percentile(arr, 95)), 3),
        "max": round(float(arr.max()), 3),
    }


def _rate(num: int, den: int) -> float | None:
    return round(num / den, 4) if den else None


def summarize(photos: list[dict]) -> dict:
    """Aggregate per-photo results into the flat metric dict the report and diff use."""
    gts = [g for p in photos for g in p["gt"]]
    labelled_photos = [p for p in photos if p["n_gt_quads"] > 0]
    fully = [p for p in photos if p["fully_labelled"]]

    det_tp = sum(p["det_tp"] for p in photos)
    det_fn = sum(p["det_fn"] for p in photos)
    det_fp = sum(p["det_fp"] for p in photos)
    corner_px = [g["corner_err_px"] for g in gts if g["corner_err_px"] is not None]
    corner_pct = [g["corner_err_pct"] for g in gts if g["corner_err_pct"] is not None]

    evaluated = [g for g in gts if g["id_evaluated"]]
    n_id = len(evaluated)

    def top1(tier: str) -> int:
        return sum(1 for g in evaluated if g[f"{tier}_rank"] == 0)

    def topn(tier: str) -> int:
        return sum(1 for g in evaluated if g[f"{tier}_rank"] is not None)

    stage1_known = [g for g in evaluated if g["stage1_hit"] is not None]
    detect_ms = [p["detect_ms"] for p in photos if p["kind"] == "photo"]
    identify_ms = [
        d["identify_ms"] for p in photos for d in p["detections"] if d["identify_ms"] is not None
    ]

    return {
        "photos": len(photos),
        "gt_cards": len(gts),
        "gt_with_quads": sum(1 for g in gts if g["has_quad"]),
        "photos_with_quads": len(labelled_photos),
        "photos_fully_labelled": len(fully),
        "detections": sum(p["n_detected"] for p in photos),
        "det_tp": det_tp,
        "det_fn": det_fn,
        "det_fp": det_fp,
        "det_recall": _rate(det_tp, det_tp + det_fn),
        "det_precision": _rate(det_tp, det_tp + det_fp),
        "fp_per_photo": _rate(det_fp, len(fully)),
        "corner_err_px": _pctl(corner_px),
        "corner_err_pct": _pctl(corner_pct),
        "count_ok": sum(1 for p in photos if p["count_ok"]),
        "count_ok_rate": _rate(sum(1 for p in photos if p["count_ok"]), len(photos)),
        "unresolved": sum(1 for g in gts if g["resolved"]["how"] == "unresolved"),
        "fuzzy_resolutions": sum(
            1 for g in gts if g["resolved"]["warning"] and g["resolved"]["scryfall_id"]
        ),
        "id_evaluated": n_id,
        "top1_strict": top1("strict"),
        "top1_family": top1("family"),
        "top1_lenient": top1("lenient"),
        "topn_strict": topn("strict"),
        "topn_family": topn("family"),
        "topn_lenient": topn("lenient"),
        "top1_strict_rate": _rate(top1("strict"), n_id),
        "top1_family_rate": _rate(top1("family"), n_id),
        "top1_lenient_rate": _rate(top1("lenient"), n_id),
        "topn_strict_rate": _rate(topn("strict"), n_id),
        "topn_family_rate": _rate(topn("family"), n_id),
        "topn_lenient_rate": _rate(topn("lenient"), n_id),
        "stage1_recall": _rate(sum(1 for g in stage1_known if g["stage1_hit"]), len(stage1_known)),
        "stage1_recall_hash": _rate(
            sum(1 for g in stage1_known if g.get("stage1_hit_hash")), len(stage1_known)
        ),
        "ocr_ran": sum(1 for g in evaluated if g.get("ocr_ran")),
        "ocr_name_read": sum(1 for g in evaluated if g.get("ocr_name")),
        "ocr_name_ok": sum(1 for g in evaluated if g.get("ocr_name_ok")),
        "ocr_collector_read": sum(1 for g in evaluated if g.get("ocr_collector")),
        "ocr_collector_ok": sum(1 for g in evaluated if g.get("ocr_collector_ok")),
        "false_confident": sum(1 for g in evaluated if g["false_confident"]),
        "false_confident_rate": _rate(sum(1 for g in evaluated if g["false_confident"]), n_id),
        "detect_ms": _pctl(detect_ms),
        "identify_ms": _pctl(identify_ms),
    }


def summarize_by_background(photos: list[dict]) -> dict[str, dict]:
    """:func:`summarize` per ``background`` value, keys sorted."""
    groups: dict[str, list[dict]] = {}
    for p in photos:
        groups.setdefault(p["background"], []).append(p)
    return {k: summarize(v) for k, v in sorted(groups.items())}


def failures(photos: list[dict]) -> list[str]:
    """Human-readable list of everything that was not a clean hit."""
    out: list[str] = []
    for p in photos:
        tag = p["fileName"]
        if not p["count_ok"]:
            out.append(f"{tag}: detected {p['n_detected']} of {p['n_gt']} listed cards")
        for d in p["detections"]:
            if d["is_fp"]:
                top = d["top1"]
                what = (
                    f" (top-1 {top['name']} {top['set']}:{top['collectorNumber']})" if top else ""
                )
                out.append(f"{tag}: false positive detection #{d['index']}{what}")
        for g in p["gt"]:
            name = f"{g['name']} {g['set'] or '?'}:{g['number'] or '?'}"
            if g["resolved"]["how"] == "unresolved":
                out.append(f"{tag}: {name}: label unresolved — {g['resolved']['warning']}")
                continue
            if g["has_quad"] and g["det_index"] is None:
                out.append(f"{tag}: {name}: not detected (no quad at IoU threshold)")
            if not g["id_evaluated"]:
                continue
            top = g["top1"]
            top_s = (
                f"{top['name']} {top['set']}:{top['collectorNumber']} "
                f"(inliers {top['inliers']}, {'confident' if top['confident'] else 'unsure'})"
                if top
                else "no result"
            )
            if g["det_index"] is None:
                out.append(f"{tag}: {name}: no detection's results matched it")
            elif g["lenient_rank"] != 0:
                out.append(f"{tag}: {name}: WRONG CARD — top-1 {top_s}")
            elif g["strict_rank"] != 0:
                tier = "family" if g["family_rank"] == 0 else "lenient only"
                out.append(f"{tag}: {name}: wrong printing ({tier}) — top-1 {top_s}")
            if g["false_confident"]:
                out.append(f"{tag}: {name}: FALSE CONFIDENT — top-1 {top_s}")
            if g["stage1_hit"] is False:
                out.append(f"{tag}: {name}: missed the Stage-1 shortlist")
    return out


# --------------------------------------------------------------------------
# Baseline diff
# --------------------------------------------------------------------------

# (metric path, direction, extra allowance). "min" = must not drop by more than
# tolerance; "max" = must not rise by more than tolerance + allowance.
_DETECTION_GATES = (
    (("det_recall",), "min", 0.0),
    (("det_precision",), "min", 0.0),
    (("fp_per_photo",), "max", 0.1),
    (("corner_err_pct", "p95"), "max", 0.3),
)
_IDENTIFICATION_GATES = (
    (("top1_strict_rate",), "min", 0.0),
    (("top1_family_rate",), "min", 0.0),
    (("top1_lenient_rate",), "min", 0.0),
    (("topn_lenient_rate",), "min", 0.0),
    (("stage1_recall",), "min", 0.0),
    (("false_confident_rate",), "max", 0.0),
)


def _dig(d: dict, path: tuple[str, ...]):
    for key in path:
        if not isinstance(d, dict) or key not in d:
            return None
        d = d[key]
    return d


def _summary_of(report: dict) -> dict:
    return report.get("summary", report)


def diff_reports(
    current: dict,
    baseline: dict,
    tolerance: float = 0.0,
    corner_tol_px: float = 1.0,
    *,
    gate_identification: bool = False,
) -> list[str]:
    """Compare two reports (or summaries); return regression messages (empty = OK).

    Gates on detection recall / precision (may not drop by more than
    ``tolerance``), false positives per photo (may not rise by more than
    ``0.1 + tolerance``), p95 corner error in percent (``0.3 + tolerance``) and
    in pixels (``corner_tol_px``). Identification metrics are only gated with
    ``gate_identification`` because they depend on the live index contents,
    which a detection-only baseline does not pin. Overall and per-background
    summaries are both checked; a background missing from either side is
    skipped. A metric that is ``None`` on either side (no data) never fails.
    """
    gates = list(_DETECTION_GATES) + (list(_IDENTIFICATION_GATES) if gate_identification else [])
    scopes = [("overall", _summary_of(current), _summary_of(baseline))]
    cur_bg = current.get("by_background", {}) if "summary" in current else {}
    base_bg = baseline.get("by_background", {}) if "summary" in baseline else {}
    for bg in sorted(set(cur_bg) & set(base_bg)):
        scopes.append((f"background={bg}", cur_bg[bg], base_bg[bg]))

    problems: list[str] = []
    for scope, cur, base in scopes:
        checks = [(path, direction, allow, tolerance) for path, direction, allow in gates]
        checks.append((("corner_err_px", "p95"), "max", 0.0, corner_tol_px))
        for path, direction, allow, tol in checks:
            c, b = _dig(cur, path), _dig(base, path)
            if c is None or b is None:
                continue
            name = ".".join(path)
            if direction == "min" and c < b - tol:
                problems.append(f"{scope}: {name} dropped {b:.4f} → {c:.4f} (tolerance {tol})")
            elif direction == "max" and c > b + allow + tol:
                problems.append(f"{scope}: {name} rose {b:.4f} → {c:.4f} (allowed +{allow + tol})")
    return problems


def describe_diff(current: dict, baseline: dict) -> list[str]:
    """One line per gated metric showing baseline → current (for the console)."""
    cur, base = _summary_of(current), _summary_of(baseline)
    lines = []
    for path, _direction, _allow in (*_DETECTION_GATES, *_IDENTIFICATION_GATES):
        c, b = _dig(cur, path), _dig(base, path)
        if c is None and b is None:
            continue
        lines.append(f"  {'.'.join(path):22s} {_fmt(b):>8} → {_fmt(c):>8}")
    lines.append(
        f"  {'corner_err_px.p95':22s} {_fmt(_dig(base, ('corner_err_px', 'p95'))):>8} → "
        f"{_fmt(_dig(cur, ('corner_err_px', 'p95'))):>8}"
    )
    return lines


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------


def _fmt(v) -> str:
    if v is None:
        return "n/a"
    if isinstance(v, float):
        return f"{v:.3f}" if abs(v) < 10 else f"{v:.1f}"
    return str(v)


def _pct(rate: float | None, num: int | None = None, den: int | None = None) -> str:
    if rate is None:
        return "   n/a"
    s = f"{100.0 * rate:5.1f}%"
    if num is not None and den is not None:
        s += f" ({num}/{den})"
    return s


def _print_summary(title: str, s: dict, detection_only: bool) -> None:
    print(f"\n================ {title} ================")
    print(
        f"  photos             : {s['photos']}  (with quads: {s['photos_with_quads']}, "
        f"fully labelled: {s['photos_fully_labelled']})"
    )
    print(f"  GT cards           : {s['gt_cards']}  (with quads: {s['gt_with_quads']})")
    print(
        f"  detections         : {s['detections']}   count check ok: "
        f"{_pct(s['count_ok_rate'], s['count_ok'], s['photos'])}"
    )
    print(f"  det recall @IoU    : {_pct(s['det_recall'], s['det_tp'], s['det_tp'] + s['det_fn'])}")
    print(
        f"  det precision      : {_pct(s['det_precision'], s['det_tp'], s['det_tp'] + s['det_fp'])}"
        f"   FP/photo: {_fmt(s['fp_per_photo'])}"
    )
    ce, cp = s["corner_err_px"], s["corner_err_pct"]
    print(
        f"  corner error       : mean {_fmt(ce['mean'])} px / median {_fmt(ce['median'])} / "
        f"p95 {_fmt(ce['p95'])} px  (p95 {_fmt(cp['p95'])} % of card width)"
    )
    print(
        f"  detect latency     : {_fmt(s['detect_ms']['mean'])} ms/photo (median {_fmt(s['detect_ms']['median'])})"
    )
    if s["unresolved"] or s["fuzzy_resolutions"]:
        print(
            f"  labels             : {s['unresolved']} unresolved, "
            f"{s['fuzzy_resolutions']} resolved with warnings"
        )
    if detection_only:
        print("========================================================")
        return
    n = s["id_evaluated"]
    print(f"  identified (den.)  : {n}")
    print(
        f"  Top-1 strict       : {_pct(s['top1_strict_rate'], s['top1_strict'], n)}   exact printing"
    )
    print(
        f"  Top-1 family       : {_pct(s['top1_family_rate'], s['top1_family'], n)}   set + base number"
    )
    print(
        f"  Top-1 lenient      : {_pct(s['top1_lenient_rate'], s['top1_lenient'], n)}   same card (oracle)"
    )
    print(f"  Top-N strict       : {_pct(s['topn_strict_rate'], s['topn_strict'], n)}")
    print(f"  Top-N lenient      : {_pct(s['topn_lenient_rate'], s['topn_lenient'], n)}")
    print(
        f"  Stage-1 recall     : {_pct(s['stage1_recall'])}   (pHash alone {_pct(s.get('stage1_recall_hash'))})"
    )
    if s.get("ocr_ran"):
        ran = s["ocr_ran"]
        print(
            f"  OCR (on {ran})       : name read {_pct(s['ocr_name_read'] / ran, s['ocr_name_read'], ran)}, "
            f"correct {_pct(s['ocr_name_ok'] / ran, s['ocr_name_ok'], ran)}; collector read "
            f"{_pct(s['ocr_collector_read'] / ran, s['ocr_collector_read'], ran)}, correct "
            f"{_pct(s['ocr_collector_ok'] / ran, s['ocr_collector_ok'], ran)}"
        )
    print(f"  False 'confident'  : {_pct(s['false_confident_rate'], s['false_confident'], n)}")
    print(
        f"  identify latency   : {_fmt(s['identify_ms']['mean'])} ms/crop "
        f"(median {_fmt(s['identify_ms']['median'])})"
    )
    print("========================================================")


def _print_background_table(by_bg: dict[str, dict], detection_only: bool) -> None:
    if len(by_bg) < 2:
        return
    print("\nper background:")
    head = f"  {'background':16s} {'photos':>6} {'cards':>5} {'recall':>7} {'prec':>7} {'FP/ph':>6} {'p95%':>6}"
    if not detection_only:
        head += f" {'strict':>7} {'family':>7} {'lenient':>8}"
    print(head)
    for bg, s in by_bg.items():
        line = (
            f"  {bg:16s} {s['photos']:>6} {s['gt_cards']:>5} {_pct(s['det_recall']):>7} "
            f"{_pct(s['det_precision']):>7} {_fmt(s['fp_per_photo']):>6} "
            f"{_fmt(s['corner_err_pct']['p95']):>6}"
        )
        if not detection_only:
            line += (
                f" {_pct(s['top1_strict_rate']):>7} {_pct(s['top1_family_rate']):>7} "
                f"{_pct(s['top1_lenient_rate']):>8}"
            )
        print(line)


def _git_sha() -> str | None:
    try:
        return (
            subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=Path(__file__).resolve().parent,
                stderr=subprocess.DEVNULL,
            )
            .decode()
            .strip()
        )
    except Exception:
        return None


def _versions() -> dict:
    import rapidfuzz

    return {
        "python": platform.python_version(),
        "opencv": cv2.__version__,
        "numpy": np.__version__,
        "rapidfuzz": rapidfuzz.__version__,
    }


def build_report(
    photos: list[dict], opts: Options, datasets: list[str], index_size: int | None
) -> dict:
    """Assemble the full JSON report."""
    return {
        "schema": SCHEMA,
        "created": datetime.now(UTC).isoformat(timespec="seconds"),
        "git_sha": _git_sha(),
        "versions": _versions(),
        "config": {k: getattr(config, k) for k in _CONFIG_KEYS if hasattr(config, k)},
        "index_size": index_size,
        "datasets": datasets,
        "options": opts.to_dict(),
        "summary": summarize(photos),
        "by_background": summarize_by_background(photos),
        "failures": failures(photos),
        "photos": photos,
    }


_CSV_FIELDS = [
    "dataset",
    "fileName",
    "background",
    "row_kind",
    "card_index",
    "name",
    "set",
    "number",
    "resolved_how",
    "resolved_scryfall_id",
    "has_quad",
    "orientation",
    "det_index",
    "match_how",
    "iou",
    "corner_err_px",
    "corner_err_pct",
    "top1_name",
    "top1_set",
    "top1_number",
    "top1_inliers",
    "top1_confident",
    "strict_rank",
    "family_rank",
    "lenient_rank",
    "stage1_hit",
    "stage1_hit_hash",
    "false_confident",
    "ocr_name",
    "ocr_name_ok",
    "ocr_collector",
    "ocr_collector_ok",
]


def write_csv(path: Path, photos: list[dict]) -> None:
    """One row per GT card, plus one row per false-positive detection."""
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=_CSV_FIELDS)
        w.writeheader()
        for p in photos:
            base = {
                "dataset": p["dataset"],
                "fileName": p["fileName"],
                "background": p["background"],
            }
            for g in p["gt"]:
                top = g["top1"] or {}
                w.writerow(
                    {
                        **base,
                        "row_kind": "gt",
                        "card_index": g["index"],
                        "name": g["name"],
                        "set": g["set"],
                        "number": g["number"],
                        "resolved_how": g["resolved"]["how"],
                        "resolved_scryfall_id": g["resolved"]["scryfall_id"],
                        "has_quad": g["has_quad"],
                        "orientation": g["orientation"],
                        "det_index": g["det_index"],
                        "match_how": g["match_how"],
                        "iou": g["iou"],
                        "corner_err_px": g["corner_err_px"],
                        "corner_err_pct": g["corner_err_pct"],
                        "top1_name": top.get("name"),
                        "top1_set": top.get("set"),
                        "top1_number": top.get("collectorNumber"),
                        "top1_inliers": top.get("inliers"),
                        "top1_confident": top.get("confident"),
                        "strict_rank": g["strict_rank"],
                        "family_rank": g["family_rank"],
                        "lenient_rank": g["lenient_rank"],
                        "stage1_hit": g["stage1_hit"],
                        "stage1_hit_hash": g.get("stage1_hit_hash"),
                        "false_confident": g["false_confident"],
                        "ocr_name": g.get("ocr_name"),
                        "ocr_name_ok": g.get("ocr_name_ok"),
                        "ocr_collector": g.get("ocr_collector"),
                        "ocr_collector_ok": g.get("ocr_collector_ok"),
                    }
                )
            for d in p["detections"]:
                if not d["is_fp"]:
                    continue
                top = d["top1"] or {}
                w.writerow(
                    {
                        **base,
                        "row_kind": "fp",
                        "det_index": d["index"],
                        "top1_name": top.get("name"),
                        "top1_set": top.get("set"),
                        "top1_number": top.get("collectorNumber"),
                        "top1_inliers": top.get("inliers"),
                        "top1_confident": top.get("confident"),
                    }
                )


# --------------------------------------------------------------------------
# Overlays
# --------------------------------------------------------------------------

_GT = (0, 200, 0)  # green
_TP = (255, 120, 0)  # blue
_FP = (0, 0, 230)  # red
_FN = (0, 140, 255)  # orange


def _dashed_poly(canvas: np.ndarray, pts: np.ndarray, colour, thickness: int) -> None:
    """Polyline drawn as dashes (OpenCV has no dashed style)."""
    n = len(pts)
    for k in range(n):
        a, b = pts[k], pts[(k + 1) % n]
        length = float(np.linalg.norm(b - a))
        steps = max(int(length / 24), 1)
        for s in range(0, steps, 2):
            p = a + (b - a) * (s / steps)
            q = a + (b - a) * (min(s + 1, steps) / steps)
            cv2.line(canvas, tuple(p.astype(int)), tuple(q.astype(int)), colour, thickness)


def _outlined_text(canvas: np.ndarray, text: str, org: tuple[int, int], colour) -> None:
    """Text with a black outline so it stays legible over card art."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(canvas, text, org, font, 0.65, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(canvas, text, org, font, 0.65, colour, 2, cv2.LINE_AA)


def draw_eval_overlay(image_bgr: np.ndarray, photo: dict) -> np.ndarray:
    """GT green, TP blue, FP red, FN orange dashed, with top-1 text per detection."""
    h, w = image_bgr.shape[:2]
    scale = min(1.0, OVERLAY_WIDTH / w)
    canvas = cv2.resize(
        image_bgr, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA
    )
    t = max(2, canvas.shape[0] // 600)

    for g in photo["gt"]:
        if g["quad"] is None:
            continue
        pts = np.asarray(g["quad"], dtype=np.float32) * scale
        if g["det_index"] is None:
            _dashed_poly(canvas, pts, _FN, t + 1)
            _outlined_text(canvas, f"FN {g['name']}", tuple(pts[0].astype(int) + (8, -8)), _FN)
        else:
            cv2.polylines(canvas, [pts.astype(np.int32).reshape(-1, 1, 2)], True, _GT, t)
    for d in photo["detections"]:
        pts = np.asarray(d["quad"], dtype=np.float32) * scale
        colour = _FP if d["is_fp"] else _TP
        cv2.polylines(canvas, [pts.astype(np.int32).reshape(-1, 1, 2)], True, colour, t)
        top = d["top1"]
        label = "FP " if d["is_fp"] else ""
        if top:
            label += f"{top['name']} {top['set']}:{top['collectorNumber']} ({top['inliers']})"
        elif d["gt_index"] is not None:
            label += photo["gt"][d["gt_index"]]["name"] or ""
        anchor = pts.mean(axis=0).astype(int)
        _outlined_text(canvas, label, (int(anchor[0]) - 60, int(anchor[1])), colour)
    return canvas


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------


def load_datasets(paths: list[str], opts: Options) -> list[tuple[Path, dict]]:
    """Load and validate every dataset; returns ``(root, entry)`` pairs after filtering.

    Raises:
        ValueError: with all validation problems joined, if any dataset is invalid.
    """
    out: list[tuple[Path, dict]] = []
    problems: list[str] = []
    for p in paths:
        root = labels.dataset_dir(p)
        entries = labels.load_manifest(p)
        problems += [f"{root}: {m}" for m in labels.validate_manifest(entries, root)]
        for e in entries:
            if opts.tag and opts.tag not in (e.get("tags") or []):
                continue
            out.append((root, e))
    if problems:
        raise ValueError("\n".join(problems))
    return out


def run(paths: list[str], opts: Options, *, overlay_dir: Path | None = None) -> dict:
    """Evaluate every entry of every dataset and return the report dict."""
    pairs = load_datasets(paths, opts)
    maps: labels.IndexMaps | None = None
    if not opts.detection_only:
        maps = labels.IndexMaps.load()
        if maps.size == 0:
            raise RuntimeError("the identification index is empty — build it first")
    else:
        # Labels still resolve offline-free; without the index every card is
        # "unresolved", which is fine for detection metrics.
        maps = None

    if overlay_dir is not None:
        overlay_dir.mkdir(parents=True, exist_ok=True)

    photos: list[dict] = []
    for i, (root, entry) in enumerate(pairs, start=1):
        result = evaluate_entry(entry, root, maps, opts)
        photos.append(result)
        status = f"{result['n_detected']} det / {result['n_gt']} gt"
        if result["n_gt_quads"]:
            status += f", tp {result['det_tp']} fn {result['det_fn']} fp {result['det_fp']}"
        if not opts.detection_only:
            hits = sum(1 for g in result["gt"] if g["lenient_rank"] == 0)
            status += f", lenient top-1 {hits}/{sum(1 for g in result['gt'] if g['id_evaluated'])}"
        print(f"  [{i}/{len(pairs)}] {entry['fileName']}: {status}")
        if overlay_dir is not None:
            image = detection.load_image_bgr((root / entry["fileName"]).read_bytes())
            out = overlay_dir / f"{Path(entry['fileName']).stem}.eval.jpg"
            cv2.imwrite(str(out), draw_eval_overlay(image, result), [cv2.IMWRITE_JPEG_QUALITY, 85])

    return build_report(
        photos,
        opts,
        [str(labels.dataset_dir(p)) for p in paths],
        None if maps is None else maps.size,
    )


def hash_histogram(paths: list[str], opts: Options, *, random_per_photo: int = 20) -> int:
    """Print Hamming-distance distributions of true quads vs. non-card rectangles.

    Sets the two verification thresholds (``VERIFY_MAX_HAMMING`` /
    ``VERIFY_AMBIGUOUS_HAMMING``) from data rather than from the 64-bit random
    model: for every labelled quad the detector's own thumbnail warp
    (:func:`app.verify.warp_small`) is hashed against the live index, and the
    same is done for three kinds of impostor in the same photo — random
    card-shaped rectangles, the two halves of each true quad (what a grid
    split of a lone card produces) and each true quad grown by 8 % (a
    sleeve/shadow-inflated outline). Requires a non-empty index.
    """
    from . import matcher
    from . import verify as verify_mod
    from .candidates import expand_quad

    def dist(work_img: np.ndarray, quad_work: np.ndarray) -> int | None:
        res = matcher.nearest_hash_distance(verify_mod.warp_small(work_img, quad_work))
        return None if res is None else int(res[0])

    if matcher.index_size() == 0:
        print("error: the identification index is empty", file=sys.stderr)
        return 1
    rng = np.random.default_rng(opts.seed)
    buckets: dict[str, list[int]] = {"true": [], "random": [], "half": [], "inflated": []}
    for root, entry in load_datasets(paths, opts):
        if labels.entry_kind(entry) != "photo":
            continue
        image = detection.load_image_bgr((root / entry["fileName"]).read_bytes())
        work, scale = detection._downscale(image, config.WORK_LONG_EDGES[0])
        h, w = work.shape[:2]
        for card in entry.get("cards", []):
            quad = _usable_quad(card, opts.include_drafts)
            if quad is None:
                continue
            q = geometry.order_points(quad) * scale
            d = dist(work, q)
            if d is not None:
                buckets["true"].append(d)
            d = dist(work, expand_quad(q, 1.08, 1.08))
            if d is not None:
                buckets["inflated"].append(d)
            # Halves along the long axis (a 2 x 1 split of a single card).
            qo = geometry.order_points(q)
            top_mid = (qo[0] + qo[1]) / 2
            bot_mid = (qo[3] + qo[2]) / 2
            left_mid = (qo[0] + qo[3]) / 2
            right_mid = (qo[1] + qo[2]) / 2
            if np.linalg.norm(qo[1] - qo[0]) > np.linalg.norm(qo[3] - qo[0]):
                halves = [[qo[0], top_mid, bot_mid, qo[3]], [top_mid, qo[1], qo[2], bot_mid]]
            else:
                halves = [[qo[0], qo[1], right_mid, left_mid], [left_mid, right_mid, qo[2], qo[3]]]
            for half in halves:
                d = dist(work, np.asarray(half, dtype=np.float32))
                if d is not None:
                    buckets["half"].append(d)
        for _ in range(random_per_photo):
            long_side = rng.uniform(0.15, 0.6) * max(h, w)
            short_side = long_side * config.CARD_ASPECT_RATIO
            angle = rng.uniform(0, np.pi)
            cx, cy = (
                rng.uniform(long_side / 2, w - long_side / 2),
                rng.uniform(long_side / 2, h - long_side / 2),
            )
            c, s_ = np.cos(angle), np.sin(angle)
            rect = (
                np.array(
                    [
                        [-short_side, -long_side],
                        [short_side, -long_side],
                        [short_side, long_side],
                        [-short_side, long_side],
                    ]
                )
                / 2
            )
            rect = rect @ np.array([[c, -s_], [s_, c]]).T + (cx, cy)
            d = dist(work, rect.astype(np.float32))
            if d is not None:
                buckets["random"].append(d)

    print(
        f"hash histogram over {len(buckets['true'])} true quads (index size {matcher.index_size()}):"
    )
    print(
        f"  thresholds: accept <= {config.VERIFY_MAX_HAMMING}, ambiguous <= {config.VERIFY_AMBIGUOUS_HAMMING}"
    )
    for name, values in buckets.items():
        if not values:
            continue
        arr = np.asarray(values)
        pct = np.percentile(arr, [5, 25, 50, 75, 95])
        counts = np.bincount(arr, minlength=34)[:34]
        print(
            f"  {name:9s} n={len(arr):4d}  p5/25/50/75/95 = {pct[0]:.0f}/{pct[1]:.0f}/{pct[2]:.0f}/{pct[3]:.0f}/{pct[4]:.0f}"
            f"  <= {config.VERIFY_MAX_HAMMING}: {np.mean(arr <= config.VERIFY_MAX_HAMMING):.0%}"
            f"  <= {config.VERIFY_AMBIGUOUS_HAMMING}: {np.mean(arr <= config.VERIFY_AMBIGUOUS_HAMMING):.0%}"
        )
        print("            counts by distance 0..33: " + " ".join(str(int(c)) for c in counts))
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.evaluate_photos",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "datasets",
        nargs="+",
        metavar="DATASET",
        help="directory holding a test-images.json (or the manifest path)",
    )
    parser.add_argument(
        "--detection-only", action="store_true", help="skip identification (no Postgres needed)"
    )
    parser.add_argument(
        "--gt-crops",
        action="store_true",
        help="identify the labelled quads' own warps instead of detections",
    )
    parser.add_argument("--iou", type=float, default=0.7, help="IoU threshold for a true positive")
    parser.add_argument(
        "--top-n",
        type=int,
        default=config.TOP_N_MATCHES,
        help="candidates per crop for the top-N metrics",
    )
    parser.add_argument("--tag", help="only entries carrying this tag")
    parser.add_argument(
        "--include-drafts",
        action="store_true",
        help="use quadSource=draft labels as well as verified ones",
    )
    parser.add_argument("--json", metavar="PATH", help="write the full report as JSON")
    parser.add_argument("--csv", metavar="PATH", help="write one row per GT card (+ FP rows)")
    parser.add_argument("--overlay-dir", metavar="DIR", help="write <stem>.eval.jpg overlays")
    parser.add_argument("--baseline", metavar="PATH", help="compare against a saved report")
    parser.add_argument(
        "--tolerance",
        type=float,
        default=0.0,
        help="allowed drop in gated rates (0..1) before failing",
    )
    parser.add_argument(
        "--corner-tolerance-px",
        type=float,
        default=1.0,
        help="allowed rise in p95 corner error (px)",
    )
    parser.add_argument(
        "--gate-identification",
        action="store_true",
        help="also fail on identification regressions vs the baseline",
    )
    parser.add_argument("--seed", type=int, default=0, help="cv2 RNG seed (RANSAC)")
    parser.add_argument(
        "--hash-histogram",
        action="store_true",
        help="print Hamming distances of true quads vs. random/half/inflated rectangles and exit",
    )
    args = parser.parse_args(argv)

    opts = Options(
        detection_only=args.detection_only,
        gt_crops=args.gt_crops,
        iou=args.iou,
        top_n=args.top_n,
        tag=args.tag,
        include_drafts=args.include_drafts,
        seed=args.seed,
    )
    if args.hash_histogram:
        try:
            return hash_histogram(args.datasets, opts)
        except (OSError, ValueError, RuntimeError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
    print(
        f"evaluate_photos · datasets={args.datasets} · detection_only={opts.detection_only} · "
        f"iou={opts.iou} · top_n={opts.top_n} · seed={opts.seed}"
    )
    try:
        report = run(
            args.datasets, opts, overlay_dir=Path(args.overlay_dir) if args.overlay_dir else None
        )
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    _print_summary("real-photo accuracy", report["summary"], opts.detection_only)
    _print_background_table(report["by_background"], opts.detection_only)
    if report["failures"]:
        print("\nfailures / notes:")
        for line in report["failures"]:
            print(f"  - {line}")
    else:
        print("\nno failures.")

    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print(f"wrote {args.json}")
    if args.csv:
        write_csv(Path(args.csv), report["photos"])
        print(f"wrote {args.csv}")

    if args.baseline:
        try:
            with open(args.baseline, encoding="utf-8") as fh:
                baseline = json.load(fh)
        except (OSError, ValueError) as exc:
            print(f"error: cannot read baseline: {exc}", file=sys.stderr)
            return 1
        print(
            f"\nbaseline {args.baseline} ({baseline.get('created')}, git {baseline.get('git_sha')}):"
        )
        for line in describe_diff(report, baseline):
            print(line)
        regressions = diff_reports(
            report,
            baseline,
            args.tolerance,
            args.corner_tolerance_px,
            gate_identification=args.gate_identification,
        )
        if regressions:
            print("\nREGRESSION:")
            for r in regressions:
                print(f"  ! {r}")
            return 2
        print("no regression against the baseline.")
    return 0


def _cli() -> int:
    """``main`` plus an orderly pool shutdown.

    Python 3.14 refuses to join threads during interpreter finalisation, so a
    psycopg pool that is still open at exit prints a noisy (harmless)
    ``PythonFinalizationError`` traceback; closing it explicitly avoids that.
    """
    try:
        return main(sys.argv[1:])
    finally:
        from . import index_db

        index_db.close_pool()


if __name__ == "__main__":
    raise SystemExit(_cli())

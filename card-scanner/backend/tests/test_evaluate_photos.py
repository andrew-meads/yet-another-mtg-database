"""Tests for the real-photo harness (``app.evaluate_photos``) without Postgres.

``summarize`` / ``diff_reports`` / ``failures`` / ``write_csv`` are exercised on
hand-built per-photo results; ``evaluate_entry`` is run in detection-only mode
on a synthetic photo so the whole detect → match → score path is covered.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from app import evaluate_photos as ep
from app import labels

# --- hand-built results ------------------------------------------------------------


def _gt(
    name="Card",
    *,
    has_quad=True,
    det_index=0,
    iou=0.95,
    err_px=2.0,
    err_pct=0.5,
    strict=0,
    family=0,
    lenient=0,
    stage1=True,
    confident_wrong=False,
    evaluated=True,
    how="exact",
    warning=None,
    top1=None,
):
    return {
        "index": 0,
        "name": name,
        "set": "tla",
        "number": "1",
        "resolved": {
            "scryfall_id": None if how == "unresolved" else "sid",
            "oracle_id": None if how == "unresolved" else "oid",
            "how": how,
            "warning": warning,
            "set_code": "tla",
            "collector_number": "1",
            "name": name,
        },
        "has_quad": has_quad,
        "quad": [[0, 0], [10, 0], [10, 10], [0, 10]] if has_quad else None,
        "quad_source": "verified" if has_quad else None,
        "orientation": "upright" if has_quad else None,
        "det_index": det_index,
        "match_how": None if det_index is None else ("iou" if has_quad else "identity"),
        "iou": iou if det_index is not None and has_quad else None,
        "corner_err_px": err_px if det_index is not None and has_quad else None,
        "corner_err_pct": err_pct if det_index is not None and has_quad else None,
        "top1": top1
        or {
            "scryfallId": "sid",
            "name": name,
            "set": "tla",
            "collectorNumber": "1",
            "face": "single",
            "hammingDistance": 5,
            "inliers": 40,
            "confident": True,
        },
        "strict_rank": strict,
        "family_rank": family,
        "lenient_rank": lenient,
        "stage1_hit": stage1,
        "false_confident": confident_wrong,
        "id_evaluated": evaluated,
    }


def _photo(name, gts, *, background="white-paper", n_det=None, fp=0, fully=True, kind="photo"):
    n_det = len([g for g in gts if g["det_index"] is not None]) + fp if n_det is None else n_det
    tp = sum(1 for g in gts if g["has_quad"] and g["det_index"] is not None)
    fn = sum(1 for g in gts if g["has_quad"] and g["det_index"] is None)
    dets = [
        {
            "index": i,
            "quad": [[0, 0], [10, 0], [10, 10], [0, 10]],
            "gt_index": None,
            "is_fp": i >= n_det - fp,
            "top1": None,
            "identify_ms": 100.0,
        }
        for i in range(n_det)
    ]
    return {
        "dataset": "x",
        "fileName": name,
        "kind": kind,
        "background": background,
        "tags": [],
        "frame": [100, 100],
        "n_gt": len(gts),
        "n_gt_quads": sum(1 for g in gts if g["has_quad"]),
        "fully_labelled": fully,
        "n_detected": n_det,
        "count_ok": n_det == len(gts),
        "det_tp": tp,
        "det_fn": fn,
        "det_fp": fp,
        "unmatched_detections": fp,
        "detect_ms": 20.0,
        "gt": gts,
        "detections": dets,
    }


@pytest.fixture
def photos():
    return [
        _photo("a.jpg", [_gt("A1"), _gt("A2", err_px=4.0, err_pct=1.0)]),
        _photo(
            "b.jpg",
            [
                _gt("B1", det_index=None, evaluated=False),  # FN
                _gt("B2", strict=None, family=None, lenient=0, stage1=False),  # wrong printing
                _gt("B3", strict=None, family=None, lenient=None, confident_wrong=True),
            ],
            fp=1,
            background="wood-dark",
        ),
        # Quad-less entry: identity matching, one card never matched.
        _photo(
            "c.jpg",
            [
                _gt("C1", has_quad=False),
                _gt(
                    "C2",
                    has_quad=False,
                    det_index=None,
                    strict=None,
                    family=None,
                    lenient=None,
                    stage1=None,
                ),
            ],
            n_det=1,
            fully=False,
            background="wood-dark",
        ),
    ]


def test_summarize_counts(photos):
    s = ep.summarize(photos)
    assert s["photos"] == 3 and s["gt_cards"] == 7 and s["gt_with_quads"] == 5
    assert s["photos_with_quads"] == 2 and s["photos_fully_labelled"] == 2
    assert (s["det_tp"], s["det_fn"], s["det_fp"]) == (4, 1, 1)
    assert s["det_recall"] == pytest.approx(0.8) and s["det_precision"] == pytest.approx(0.8)
    assert s["fp_per_photo"] == pytest.approx(0.5)  # 1 FP over 2 fully-labelled photos
    assert s["corner_err_px"]["n"] == 4 and s["corner_err_px"]["max"] == 4.0
    assert s["corner_err_pct"]["p95"] == pytest.approx(0.925, abs=1e-3)
    # b: 2 TP + 1 FP = 3 detections for 3 listed cards → the count check alone passes.
    assert s["count_ok"] == 2 and s["count_ok_rate"] == pytest.approx(2 / 3, abs=1e-3)
    # Identification denominators: 2 (a) + 2 (b, B1 not detected) + 2 (c, both listed) = 6.
    assert s["id_evaluated"] == 6
    assert s["top1_strict"] == 3 and s["top1_lenient"] == 4 and s["topn_lenient"] == 4
    assert s["top1_strict_rate"] == pytest.approx(0.5)
    assert s["stage1_recall"] == pytest.approx(4 / 5, abs=1e-3)  # C2 has no shortlist
    assert s["false_confident"] == 1 and s["false_confident_rate"] == pytest.approx(1 / 6, abs=1e-3)
    assert s["unresolved"] == 0
    assert s["detect_ms"]["mean"] == 20.0 and s["identify_ms"]["n"] == 6


def test_summarize_empty_and_by_background(photos):
    s = ep.summarize([])
    assert s["photos"] == 0 and s["det_recall"] is None and s["corner_err_px"]["mean"] is None
    by_bg = ep.summarize_by_background(photos)
    assert list(by_bg) == ["white-paper", "wood-dark"]
    assert by_bg["white-paper"]["det_recall"] == 1.0
    assert by_bg["wood-dark"]["det_recall"] == pytest.approx(2 / 3, abs=1e-3)


def test_failures_lists_everything_interesting(photos):
    photos[0]["gt"][0]["resolved"].update(how="unresolved", warning="nope", scryfall_id=None)
    lines = "\n".join(ep.failures(photos))
    assert "A1" in lines and "label unresolved" in lines
    assert "B1" in lines and "not detected" in lines
    assert "B2" in lines and "wrong printing" in lines and "missed the Stage-1" in lines
    assert "B3" in lines and "WRONG CARD" in lines and "FALSE CONFIDENT" in lines
    assert "false positive detection" in lines
    assert "C2" in lines and "no detection's results matched" in lines
    assert "c.jpg: detected 1 of 2" in lines
    assert "A2" not in lines  # clean hit


def test_diff_reports_gates(photos):
    base = {"summary": ep.summarize(photos), "by_background": ep.summarize_by_background(photos)}
    same = json.loads(json.dumps(base))
    assert ep.diff_reports(same, base) == []
    assert ep.diff_reports(base["summary"], base["summary"]) == []  # bare summaries OK

    worse = json.loads(json.dumps(base))
    worse["summary"]["det_recall"] -= 0.05
    worse["summary"]["fp_per_photo"] += 0.5
    worse["summary"]["corner_err_pct"]["p95"] += 0.8
    worse["summary"]["corner_err_px"]["p95"] += 3.0
    worse["summary"]["top1_strict_rate"] -= 0.2
    problems = ep.diff_reports(worse, base)
    text = "\n".join(problems)
    assert "det_recall dropped" in text and "fp_per_photo rose" in text
    assert "corner_err_pct.p95 rose" in text and "corner_err_px.p95 rose" in text
    assert "top1_strict_rate" not in text  # identification not gated by default
    assert "top1_strict_rate" in "\n".join(ep.diff_reports(worse, base, gate_identification=True))
    # Tolerances absorb the drops.
    assert ep.diff_reports(worse, base, tolerance=0.6, corner_tol_px=5.0) == []
    # A small fp rise is inside the built-in +0.1 allowance.
    slight = json.loads(json.dumps(base))
    slight["summary"]["fp_per_photo"] += 0.05
    assert ep.diff_reports(slight, base) == []
    # Per-background regressions are reported with their scope.
    bg = json.loads(json.dumps(base))
    bg["by_background"]["wood-dark"]["det_precision"] = 0.0
    assert any(p.startswith("background=wood-dark") for p in ep.diff_reports(bg, base))
    # Missing metrics (None) never fail.
    none = json.loads(json.dumps(base))
    none["summary"]["det_recall"] = None
    assert ep.diff_reports(none, base) == []
    assert ep.describe_diff(worse, base)


def test_write_csv(tmp_path: Path, photos):
    out = tmp_path / "r.csv"
    ep.write_csv(out, photos)
    with open(out, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == 7 + 1  # one per GT card + one FP row
    assert rows[0]["row_kind"] == "gt" and rows[0]["name"] == "A1"
    assert [r for r in rows if r["row_kind"] == "fp"][0]["fileName"] == "b.jpg"


# --- evaluate_entry on a synthetic photo (detection only, no DB) ------------------------


def _synthetic_dataset(tmp_path: Path, quad_shift: int = 0) -> tuple[Path, dict]:
    """A white 1200x900 'photo' with one dark 63:88 card and a verified quad label."""
    canvas = np.full((900, 1200, 3), 245, np.uint8)
    quad = np.array([[300, 150], [300 + 441, 150], [300 + 441, 150 + 616], [300, 150 + 616]])
    cv2.fillPoly(canvas, [quad], (30, 30, 30))
    cv2.rectangle(canvas, (330, 180), (700, 500), (80, 120, 160), -1)  # some "art"
    cv2.imwrite(str(tmp_path / "01-card.jpg"), canvas)
    entry = {
        "fileName": "01-card.jpg",
        "description": "synthetic",
        "background": "white-paper",
        "cards": [
            {
                "name": "Fake",
                "set": "xxx",
                "number": "1",
                "quad": (quad + quad_shift).tolist(),
                "quadSource": "verified",
            }
        ],
    }
    labels.save_manifest([entry], tmp_path)
    return tmp_path, entry


def test_evaluate_entry_detection_only(tmp_path: Path):
    root, entry = _synthetic_dataset(tmp_path)
    result = ep.evaluate_entry(entry, root, None, ep.Options(detection_only=True))
    assert result["n_detected"] == 1 and result["det_tp"] == 1 and result["det_fp"] == 0
    gt = result["gt"][0]
    assert gt["match_how"] == "iou" and gt["iou"] > 0.95
    assert gt["corner_err_px"] < 8.0 and gt["orientation"] == "upright"
    assert gt["resolved"]["how"] == "not-resolved" and not gt["id_evaluated"]
    assert result["detections"][0]["gt_index"] == 0
    s = ep.summarize([result])
    assert s["det_recall"] == 1.0 and s["unresolved"] == 0 and s["id_evaluated"] == 0
    assert ep.failures([result]) == []


def test_evaluate_entry_counts_fn_and_fp_when_label_is_elsewhere(tmp_path: Path):
    root, entry = _synthetic_dataset(tmp_path, quad_shift=300)  # label far from the card
    result = ep.evaluate_entry(entry, root, None, ep.Options(detection_only=True))
    assert result["det_tp"] == 0 and result["det_fn"] == 1 and result["det_fp"] == 1
    assert result["count_ok"]  # the count check alone cannot see the mismatch
    lines = "\n".join(ep.failures([result]))
    assert "not detected" in lines and "false positive" in lines


def test_evaluate_entry_draft_quads_need_include_drafts(tmp_path: Path):
    root, entry = _synthetic_dataset(tmp_path)
    entry["cards"][0]["quadSource"] = "draft"
    strict = ep.evaluate_entry(entry, root, None, ep.Options(detection_only=True))
    assert strict["n_gt_quads"] == 0 and not strict["fully_labelled"] and strict["det_fp"] == 0
    loose = ep.evaluate_entry(
        entry, root, None, ep.Options(detection_only=True, include_drafts=True)
    )
    assert loose["n_gt_quads"] == 1 and loose["det_tp"] == 1


def test_run_and_report_detection_only(tmp_path: Path):
    root, _entry = _synthetic_dataset(tmp_path)
    overlay_dir = tmp_path / "ov"
    report = ep.run([str(root)], ep.Options(detection_only=True), overlay_dir=overlay_dir)
    assert report["schema"] == ep.SCHEMA and report["index_size"] is None
    assert report["summary"]["det_recall"] == 1.0
    assert report["by_background"]["white-paper"]["photos"] == 1
    assert "WORK_LONG_EDGE" in report["config"] and "DATABASE_URL" not in report["config"]
    assert report["versions"]["opencv"] == cv2.__version__
    assert (overlay_dir / "01-card.eval.jpg").is_file()
    json.dumps(report)  # fully serialisable


def test_run_rejects_invalid_dataset(tmp_path: Path):
    root, entry = _synthetic_dataset(tmp_path)
    entry["cards"][0].pop("set")
    labels.save_manifest([entry], root)
    with pytest.raises(ValueError, match="'set' is required"):
        ep.run([str(root)], ep.Options(detection_only=True))


def test_tag_filter(tmp_path: Path):
    root, entry = _synthetic_dataset(tmp_path)
    entry["tags"] = ["tilt"]
    labels.save_manifest([entry], root)
    assert ep.load_datasets([str(root)], ep.Options(tag="tilt")) != []
    assert ep.load_datasets([str(root)], ep.Options(tag="nope")) == []


def test_main_exit_codes(tmp_path: Path, capsys):
    root, _entry = _synthetic_dataset(tmp_path)
    baseline = tmp_path / "base.json"
    assert ep.main([str(root), "--detection-only", "--json", str(baseline)]) == 0
    assert ep.main([str(root), "--detection-only", "--baseline", str(baseline)]) == 0
    # Tighten the baseline so the same run now regresses → exit 2.
    data = json.loads(baseline.read_text())
    data["summary"]["det_precision"] = 1.5
    baseline.write_text(json.dumps(data))
    assert ep.main([str(root), "--detection-only", "--baseline", str(baseline)]) == 2
    assert "REGRESSION" in capsys.readouterr().out
    # Unusable dataset / baseline → exit 1.
    assert ep.main([str(tmp_path / "missing"), "--detection-only"]) == 1
    assert ep.main([str(root), "--detection-only", "--baseline", str(tmp_path / "no.json")]) == 1

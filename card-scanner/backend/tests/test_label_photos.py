"""Tests for the manifest labelling CLI in ``app.label_photos`` (no Postgres, no network).

The reference-image refinement is exercised end to end on synthetic photos: a
procedural fake card (``app.synth.make_fake_card``) is composited onto a canvas at a
known quad, a deliberately wrong quad is handed to the refiner together with the
fake card as its "Scryfall reference", and the refined quad must land on the truth.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from app import label_photos, labels, synth

TRUE_QUAD = np.float32([[300, 200], [820, 260], [790, 1000], [260, 940]])  # printed order
SECOND_QUAD = np.float32([[1000, 300], [1450, 280], [1470, 900], [1020, 920]])


def _rng(seed: int = 0) -> np.random.Generator:
    return np.random.default_rng(seed)


def _canvas() -> np.ndarray:
    """A mid-grey, lightly textured table so the crop has no false features."""
    rng = _rng(99)
    canvas = np.full((1200, 1600, 3), 150, np.uint8)
    noise = rng.integers(-12, 12, size=canvas.shape, dtype=np.int16)
    return np.clip(canvas.astype(np.int16) + noise, 0, 255).astype(np.uint8)


@pytest.fixture(scope="module")
def card() -> np.ndarray:
    return synth.make_fake_card(_rng(7), 7)


@pytest.fixture(scope="module")
def other_card() -> np.ndarray:
    return synth.make_fake_card(_rng(8), 8)


@pytest.fixture(scope="module")
def photo(card: np.ndarray, other_card: np.ndarray) -> np.ndarray:
    canvas = _canvas()
    synth.render_card(canvas, card, TRUE_QUAD, _rng(1), shadow=False, glare=0.0)
    synth.render_card(canvas, other_card, SECOND_QUAD, _rng(2), shadow=False, glare=0.0)
    return canvas


def _max_corner_error(quad: np.ndarray, truth: np.ndarray) -> float:
    return float(np.linalg.norm(np.asarray(quad, np.float32) - truth, axis=1).max())


# --- refine_quad_from_reference ------------------------------------------------------


def test_refine_snaps_a_rough_quad_onto_the_card(photo, card):
    """A quad off by up to 40 px per corner ends within a few px of the truth."""
    rough = TRUE_QUAD + np.float32([[35, -30], [-40, 25], [30, 40], [-25, -35]])
    result = label_photos.refine_quad_from_reference(photo, rough, card)
    assert result.quad is not None, result.reason
    assert result.inliers >= label_photos.REFINE_MIN_INLIERS
    assert _max_corner_error(result.quad, TRUE_QUAD) < 4.0
    assert result.shift_px == pytest.approx(
        label_photos._corner_shift(result.quad, rough), abs=1e-3
    )


def test_refine_fixes_the_corner_order(photo, card):
    """A rough quad typed in the wrong order comes back in printed order."""
    rough = np.roll(TRUE_QUAD + 20, 2, axis=0)  # printed BR first
    result = label_photos.refine_quad_from_reference(photo, rough, card)
    assert result.quad is not None, result.reason
    assert _max_corner_error(result.quad, TRUE_QUAD) < 4.0  # index 0 is the printed TL again
    assert result.shift_px < 40  # order-agnostic: the corners barely moved


def test_refine_rejects_a_reference_with_no_matches(photo):
    noise = _rng(5).integers(0, 255, size=(680, 487, 3), dtype=np.uint8)
    result = label_photos.refine_quad_from_reference(photo, TRUE_QUAD, noise)
    assert result.quad is None
    assert "matches" in result.reason or "inliers" in result.reason


def test_refine_rejects_a_fit_that_moves_the_quad_too_far(photo, card):
    """A quad far off the card must not be dragged onto it silently."""
    far = TRUE_QUAD + np.float32([220, 0])  # 40 % of the short side
    result = label_photos.refine_quad_from_reference(photo, far, card)
    assert result.quad is None
    assert result.reason


def test_corner_shift_is_order_agnostic():
    a = np.float32([[0, 0], [10, 0], [10, 10], [0, 10]])
    assert label_photos._corner_shift(np.roll(a, 1, axis=0), a) == 0.0
    assert label_photos._corner_shift(a + 3, a) == pytest.approx(np.hypot(3, 3))


# --- the refine command ------------------------------------------------------------


@pytest.fixture
def dataset(tmp_path: Path, photo: np.ndarray) -> Path:
    cv2.imwrite(str(tmp_path / "01-two.jpg"), photo, [cv2.IMWRITE_JPEG_QUALITY, 95])
    cv2.imwrite(str(tmp_path / "02-empty.jpg"), _canvas())
    rough = labels.quad_to_json(
        TRUE_QUAD + np.float32([[30, -20], [-30, 20], [20, 30], [-20, -30]])
    )
    entries = [
        {
            "fileName": "01-two.jpg",
            "description": "two fake cards",
            "cards": [
                {
                    "name": "Seven",
                    "set": "fak",
                    "number": "7",
                    "quad": rough,
                    "quadSource": "draft",
                },
                {
                    "name": "Eight",
                    "set": "fak",
                    "number": "8",
                    "quad": labels.quad_to_json(SECOND_QUAD + 25),
                    "quadSource": "verified",
                },
                {"name": "Nine", "set": "fak", "number": "9"},
            ],
        },
        {"fileName": "02-empty.jpg", "description": "nothing", "cards": []},
    ]
    labels.save_manifest(entries, tmp_path)
    return tmp_path


@pytest.fixture
def maps() -> labels.IndexMaps:
    def row(rid, sid, name, cn):
        return {
            "id": rid,
            "scryfall_id": sid,
            "oracle_id": f"oid-{cn}",
            "name": name,
            "set_code": "fak",
            "collector_number": cn,
            "face": None,
        }

    return labels.IndexMaps.from_rows(
        [row(1, "sid-7", "Seven", "7"), row(2, "sid-8", "Eight", "8"), row(3, "sid-9", "Nine", "9")]
    )


def _loader(card, other_card):
    def load(scryfall_id: str, face: str | None):
        return {"sid-7": card, "sid-8": other_card}.get(scryfall_id)

    return load


def test_refine_command_writes_drafts_and_leaves_verified_alone(
    dataset, maps, card, other_card, capsys
):
    entries = labels.load_manifest(dataset)
    problems = label_photos.refine(
        dataset, entries, None, force=False, maps=maps, load_reference=_loader(card, other_card)
    )
    out = capsys.readouterr().out
    seven, eight, nine = entries[0]["cards"]
    assert _max_corner_error(seven["quad"], TRUE_QUAD) < 4.0
    assert seven["quadSource"] == "draft"
    assert eight["quad"] == labels.quad_to_json(SECOND_QUAD + 25)  # verified: untouched
    assert "quad" not in nine and "no quad to refine" in out  # reported, not invented
    assert problems == 1  # the missing quad
    assert (dataset / "_overlays" / "01-two.refine.jpg").exists()
    assert not (dataset / "_overlays" / "02-empty.refine.jpg").exists()


def test_refine_command_force_and_prefix_selection(dataset, maps, card, other_card):
    entries = labels.load_manifest(dataset)
    problems = label_photos.refine(
        dataset,
        entries,
        ["1", "3"],
        force=True,
        maps=maps,
        load_reference=_loader(card, other_card),
    )
    seven, eight, _ = entries[0]["cards"]
    assert _max_corner_error(seven["quad"], TRUE_QUAD) < 4.0
    assert _max_corner_error(eight["quad"], SECOND_QUAD) < 4.0  # force re-refines verified quads
    assert eight["quadSource"] == "draft"  # ... and demotes them for a fresh check
    assert problems == 2  # the missing quad + "no entry with prefix 3"


def test_refine_command_reports_missing_reference(dataset, maps, capsys):
    """No reference image → the quad is left alone and counted as a thing to check."""
    entries = labels.load_manifest(dataset)
    before = [dict(c) for c in entries[0]["cards"]]
    problems = label_photos.refine(
        dataset, entries, ["01"], force=True, maps=maps, load_reference=lambda sid, face: None
    )
    out = capsys.readouterr().out
    assert out.count("no reference image") == 2  # both cards that have a quad
    assert problems == 3  # + the card without a quad
    assert entries[0]["cards"] == before


def test_cli_refine_flag_parses(monkeypatch, dataset):
    """``--refine`` with and without a list reaches ``refine`` with the right prefixes."""
    calls = []

    def fake_refine(root, entries, prefixes, *, force, maps):
        calls.append((prefixes, force))
        return 0

    monkeypatch.setattr(label_photos, "refine", fake_refine)
    monkeypatch.setattr(labels.IndexMaps, "load", classmethod(lambda cls: None))
    assert label_photos.main([str(dataset), "--refine"]) == 0
    assert label_photos.main([str(dataset), "--refine", "01,02", "--force"]) == 0
    assert calls == [(None, False), (["01", "02"], True)]

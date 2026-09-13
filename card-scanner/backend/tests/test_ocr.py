"""
Tests for app.ocr — the selection / band / orientation logic with a fake backend.

The real ONNX models are never needed here: ``FakeBackend`` implements the same
three methods as the RapidOCR adapter (detect / classify / recognize) and returns
scripted boxes and texts, so the engine's decisions (which boxes to recognise,
how band lines map back into the crop frame, how orientation votes are counted,
how failures degrade) are exercised deterministically and fast. One optional
``slow`` test runs the real models when they are present.
"""

from __future__ import annotations

import os

import numpy as np
import pytest

from app import config, ocr, ocr_models

H, W = 680, 487


def box(x, y, w, h):
    """Axis-aligned text box (4,2) in the detector's corner order."""
    return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], np.float32)


class FakeBackend:
    """Scripted stand-in for the RapidOCR adapter.

    ``script`` maps an image's ``(height, width)`` to a list of
    ``(box, text, conf, upside_down)`` entries; ``detect`` returns the boxes,
    ``recognize`` the texts of whatever strips were requested.
    """

    def __init__(self, script):
        self.script = script
        self.recognized: list[str] = []  # texts recognised, in order (to check selection)

    def detect(self, img):
        entries = self.script.get(img.shape[:2], [])
        if not entries:
            return np.empty((0, 4, 2), np.float32)
        return np.stack([e[0] for e in entries])

    def crop(self, img, box_):
        # Tag the strip with the entry it came from (via its box) so the fake
        # recogniser can look the text up again.
        entries = self.script[img.shape[:2]]
        for e in entries:
            if np.array_equal(e[0], box_):
                return e
        raise AssertionError("crop of an unknown box")

    def classify(self, strips):
        return strips, [e[3] for e in strips]

    def recognize(self, strips):
        self.recognized += [e[1] for e in strips]
        return [(e[1], e[2]) for e in strips]


def make_engine(script, **kw):
    kw.setdefault("band_passes", False)
    return ocr.OcrEngine(backend=FakeBackend(script), **kw)


def crop():
    return np.zeros((H, W, 3), np.uint8)


def test_selects_tallest_lines_and_band_boxes():
    script = {
        (H, W): [
            (box(40, 30, 200, 34), "Card Title", 0.99, False),  # tallest: title
            (box(40, 120, 380, 24), "rules line one", 0.98, False),
            (box(40, 150, 380, 24), "rules line two", 0.98, False),
            (box(40, 180, 380, 24), "rules line three", 0.98, False),
            (box(40, 640, 60, 16), "184/261 C", 0.97, False),  # bottom band, small
            (box(40, 600, 120, 10), "tiny", 0.9, False),  # below min height, not in band
        ]
    }
    eng = make_engine(script, max_lines=2, min_line_height_frac=0.02, band_fraction=0.10)
    res = eng.read_card(crop())
    texts = [line.text for line in res.lines]
    # Two tallest (title + one rules line) plus the band box; the 10 px line is skipped.
    assert texts == ["Card Title", "rules line one", "184/261 C"]
    assert res.lines[0].source == "full" and res.lines[0].center_y == pytest.approx(47 / H)


def test_min_conf_filters_garbage():
    script = {
        (H, W): [
            (box(40, 30, 200, 34), "7-HU9RA", 0.55, False),
            (box(40, 80, 200, 34), "Real Name", 0.95, False),
        ]
    }
    res = make_engine(script, min_conf=0.6).read_card(crop())
    assert [line.text for line in res.lines] == ["Real Name"]
    assert res.texts == [("Real Name", 0.95)]


def test_orientation_votes_from_classifier():
    script = {
        (H, W): [
            (box(40, 30, 300, 34), "Upside Down Title", 0.99, True),
            (box(40, 600, 40, 12), "3", 0.9, False),
        ]
    }
    res = make_engine(script).read_card(crop())
    assert res.orientation_votes[180] > res.orientation_votes[0]
    assert res.best_orientation() == 180


def test_no_lines_gives_no_orientation():
    res = make_engine({}).read_card(crop())
    assert res.lines == [] and res.best_orientation() is None


def test_band_passes_map_into_crop_frame():
    """Bottom strip lines land near y≈1; the top strip is read rotated, so a
    classifier '180' there means the text was upright in the crop."""
    band_px = int(round(2 * H * 0.10))  # strips come from the 2x upscale
    script = {
        (H, W): [],
        (band_px, 2 * W): [
            # Same strip shape for both passes; the fake can't tell them apart, so
            # both bands "see" this box. Bottom pass: not upside down → upright line
            # at the bottom. Top pass: the same flag means the line WAS upside down
            # in the crop (rotated=True) → a 180 vote.
            (box(10, 20, 200, 40), "188/261 R", 0.98, False),
        ],
    }
    eng = make_engine(script, band_passes=True)
    res = eng.read_card(crop())
    by_source = {line.source: line for line in res.lines}
    assert set(by_source) == {"band_bottom", "band_top"}
    assert 0.9 <= by_source["band_bottom"].center_y <= 1.0
    assert 0.0 <= by_source["band_top"].center_y <= 0.1
    assert by_source["band_bottom"].rotated is False
    assert by_source["band_top"].rotated is True
    assert res.elapsed_ms["bands"] >= 0


def test_band_passes_use_ocr_image_when_given():
    hi = np.zeros((1300, 930, 3), np.uint8)
    band_px = int(round(1300 * 0.10))
    seen = {}

    class Spy(FakeBackend):
        def detect(self, img):
            seen.setdefault("shapes", []).append(img.shape[:2])
            return super().detect(img)

    eng = ocr.OcrEngine(backend=Spy({}), band_passes=True)
    eng.read_card(crop(), ocr_image=hi)
    assert (band_px, 930) in seen["shapes"]


def test_backend_failure_degrades_to_none(caplog):
    class Boom(FakeBackend):
        def detect(self, img):
            raise RuntimeError("onnx exploded")

    eng = ocr.OcrEngine(backend=Boom({}))
    assert eng.read_card(crop()) is None
    assert eng.read_card(crop()) is None  # second failure is silent
    assert sum("OCR failed" in r.message for r in caplog.records) == 1


def test_vertical_text_box_metrics():
    """A side-strip name (split card) has its long edge vertical; the text height
    must be the short side so it competes fairly with horizontal titles."""
    h, w, _ = ocr.OcrEngine._box_metrics(
        np.array([[400, 50], [430, 50], [430, 350], [400, 350]], np.float32)
    )
    assert (h, w) == (30.0, 300.0)


def test_get_engine_none_when_models_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "OCR_MODEL_DIR", tmp_path)
    monkeypatch.setattr(ocr, "_engine", None)
    monkeypatch.setattr(ocr, "_engine_failed", False)
    assert ocr.models_present() is False
    assert ocr.get_engine() is None
    assert ocr.available() is False


def test_get_engine_none_when_disabled(monkeypatch):
    monkeypatch.setattr(config, "OCR_ENABLED", False)
    monkeypatch.setattr(ocr, "_engine", None)
    monkeypatch.setattr(ocr, "_engine_failed", False)
    assert ocr.get_engine() is None


@pytest.mark.slow
@pytest.mark.skipif(
    os.environ.get("SCANNER_OCR_REAL") != "1" or not ocr.models_present(),
    reason="set SCANNER_OCR_REAL=1 with models under OCR_MODEL_DIR",
)
def test_real_models_read_a_fake_card():
    from app import synth

    eng = ocr.OcrEngine(config.OCR_MODEL_DIR, threads=2)
    card = synth.make_fake_card(np.random.default_rng(3), 7)
    res = eng.read_card(card)
    joined = " ".join(t.lower() for t, _ in res.texts)
    assert "fake card 7" in joined
    assert res.best_orientation() == 0
    assert ocr_models.model_path("det").is_file()


def test_read_bands_can_be_deferred():
    """band_passes=False runs only the full pass; read_bands adds the bands later."""
    band_px = int(round(2 * H * 0.10))
    script = {
        (H, W): [(box(40, 30, 200, 34), "Card Title", 0.99, False)],
        (band_px, 2 * W): [(box(10, 20, 200, 40), "188/261 R", 0.98, False)],
    }
    eng = make_engine(script, band_passes=True)
    res = eng.read_card(crop(), band_passes=False)
    assert [line.source for line in res.lines] == ["full"]
    assert "bands" not in res.elapsed_ms
    eng.read_bands(crop(), into=res)
    assert sorted(line.source for line in res.lines) == ["band_bottom", "band_top", "full"]
    assert res.elapsed_ms["bands"] >= 0 and res.elapsed_ms["total"] >= res.elapsed_ms["full"]

"""
Tests for the FastAPI layer in ``app.main`` via Starlette's ``TestClient``.

The ``client`` fixture never enters the lifespan and the database is blocked, so
the identification index is empty: the detector runs in ``rank`` verification
mode (nothing is hash-rejected) and ``matcher.identify_card`` is stubbed per test.
These tests cover request validation, detection plumbing, the post-identification
gate for ambiguous detections, orientation handling, crop/overlay file writing and
the JSON contract — not identification quality (see test_matcher.py).
"""

from __future__ import annotations

import time

import cv2
import numpy as np

from app import config, detection, matcher

_PLACEMENTS = [(400, 600, 0.0, 0.55), (1150, 600, 90.0, 0.55)]


def _jpeg_bytes(image_bgr: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    return encoded.tobytes()


def _upload(client, payload: bytes, filename: str = "photo.jpg"):
    return client.post("/api/scan", files={"image": (filename, payload, "image/jpeg")})


def _stub_identify(monkeypatch, matches, *, orientation=None, ocr=None, seen=None):
    """Replace ``matcher.identify_card`` with a stub returning a fixed result."""

    def fake_identify_card(crop, top_n=None, *, ocr_image=None):
        if seen is not None:
            seen.append((crop, ocr_image))
        return matcher.IdentifyResult(matches=list(matches), orientation=orientation, ocr=ocr)

    monkeypatch.setattr(matcher, "identify_card", fake_identify_card)


def test_health(client):
    """The probe reports the (empty) index size and whether OCR is available."""
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["index"] == 0
    assert body["ocr"] is False  # OCR_ENABLED=0 in the test environment


def test_index_stats_reports_zero_when_database_is_blocked(client):
    """The stats endpoint must never 500 or hang on a missing index: the blocked pool
    is swallowed by the matcher and reported as an empty index, fast."""
    started = time.monotonic()

    response = client.get("/api/index/stats")

    assert response.status_code == 200
    assert response.json() == {"cards": 0}
    assert time.monotonic() - started < 2.0


def test_scan_two_card_photo(client, compose_simple, fake_cards, rng, monkeypatch):
    """A two-card composite yields two crops on disk, a debug overlay, the matches the
    matcher returned verbatim, and the new per-card detection fields."""
    sentinel = [{"scryfallId": "fake-1", "name": "Fake Card 1", "confident": True, "inliers": 40}]
    seen = []
    _stub_identify(monkeypatch, sentinel, seen=seen)
    image, _ = compose_simple(rng, fake_cards[:2], "paper", _PLACEMENTS)

    response = _upload(client, _jpeg_bytes(image))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 2
    assert len(body["cards"]) == 2
    assert len(seen) == 2
    # The matcher gets the crop and the higher-resolution warp for OCR.
    for crop, ocr_image in seen:
        assert crop.shape == (config.OUTPUT_HEIGHT, config.OUTPUT_WIDTH, 3)
        assert ocr_image is not None and ocr_image.shape[0] > crop.shape[0]

    batch_ids = set()
    for i, card in enumerate(body["cards"]):
        assert card["matches"] == sentinel
        assert card["url"] == f"/cards/{card['id']}.jpg"
        assert card["id"].endswith(f"_{i}")
        batch_ids.add(card["id"].rsplit("_", 1)[0])
        assert (card["width"], card["height"]) == (config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT)
        assert card["source"] in ("edges", "color", "color+", "split")
        assert 0.0 <= card["detectScore"] <= 1.0
        assert card["hashDistance"] is None  # empty index: nothing was hashed
        assert card["orientation"] in (0, 180)
        assert card["ocr"] is None
        crop_path = config.CARDS_DIR / f"{card['id']}.jpg"
        assert crop_path.is_file()
        saved = cv2.imread(str(crop_path))
        assert saved.shape == (config.OUTPUT_HEIGHT, config.OUTPUT_WIDTH, 3)

    # Both crops and the overlay share one batch id.
    (batch_id,) = batch_ids
    assert body["debugUrl"] == f"/cards/{batch_id}_debug.jpg"
    assert (config.CARDS_DIR / f"{batch_id}_debug.jpg").is_file()
    assert "debug" not in body  # DEBUG_JSON is off by default

    # The saved crops are served back by the static mount.
    served = client.get(body["cards"][0]["url"])
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/jpeg"


def test_scan_without_overlay_when_disabled(client, compose_simple, fake_cards, rng, monkeypatch):
    monkeypatch.setattr(config, "SAVE_DEBUG_OVERLAY", False)
    _stub_identify(monkeypatch, [])
    image, _ = compose_simple(rng, fake_cards[:1], "paper", _PLACEMENTS[:1])

    body = _upload(client, _jpeg_bytes(image)).json()

    assert body["count"] == 1
    assert body["debugUrl"] is None
    batch_id = body["cards"][0]["id"].rsplit("_", 1)[0]
    assert not (config.CARDS_DIR / f"{batch_id}_debug.jpg").exists()


def test_scan_rotates_crop_when_matcher_reports_180(
    client, compose_simple, fake_cards, rng, monkeypatch
):
    """The matcher's orientation is applied on top of the detector's before saving,
    and the response reports the total rotation."""
    saved_crops = []
    original_save = __import__("app.main", fromlist=["_save_jpeg"])._save_jpeg

    def spy_save(image, path):
        saved_crops.append((str(path), image.copy()))
        original_save(image, path)

    from app import main

    monkeypatch.setattr(main, "_save_jpeg", spy_save)
    image, _ = compose_simple(rng, fake_cards[:1], "paper", _PLACEMENTS[:1])

    # First pass: matcher says nothing about orientation.
    _stub_identify(monkeypatch, [], orientation=None)
    body_plain = _upload(client, _jpeg_bytes(image)).json()
    plain = next(
        img for path, img in saved_crops if path.endswith(body_plain["cards"][0]["id"] + ".jpg")
    )

    # Second pass: matcher says the crop is upside down.
    _stub_identify(monkeypatch, [], orientation=180)
    body_flipped = _upload(client, _jpeg_bytes(image)).json()
    flipped = next(
        img for path, img in saved_crops if path.endswith(body_flipped["cards"][0]["id"] + ".jpg")
    )

    assert (
        body_flipped["cards"][0]["orientation"]
        == (body_plain["cards"][0]["orientation"] + 180) % 360
    )
    assert np.array_equal(flipped, cv2.rotate(plain, cv2.ROTATE_180))


def _fake_detection(image_bgr: np.ndarray, verify_state: str) -> detection.DetectionResult:
    """A DetectionResult with one hand-made card in the given verification state."""
    crop = np.full((config.OUTPUT_HEIGHT, config.OUTPUT_WIDTH, 3), 90, np.uint8)
    quad = np.float32([[100, 100], [400, 100], [400, 520], [100, 520]])
    card = detection.DetectedCard(
        crop, quad, ocr_image=crop, source="edges", score=0.9, hash_distance=14, verify=verify_state
    )
    return detection.DetectionResult(
        cards=[card], rejected=[], work_scale=0.5, timings_ms={"total": 1.0}, n_candidates=3
    )


def test_scan_drops_ambiguous_card_without_orb_support(client, rng, monkeypatch):
    """An ``ambiguous`` detection whose Stage-2 inliers stay below VERIFY_MIN_INLIERS
    is not saved; with DEBUG_JSON on it shows up as rejected with reason ``orb``."""
    from app.synth import procedural_background

    photo = procedural_background(rng, 800, 600, "paper")
    monkeypatch.setattr(detection, "detect", lambda img: _fake_detection(img, "ambiguous"))
    monkeypatch.setattr(config, "DEBUG_JSON", True)
    weak = [{"scryfallId": "fake-1", "inliers": config.VERIFY_MIN_INLIERS - 1}]
    _stub_identify(monkeypatch, weak)

    body = _upload(client, _jpeg_bytes(photo)).json()

    assert body["count"] == 0
    assert body["cards"] == []
    assert body["debug"]["candidates"] == 3
    assert [r["rejected"] for r in body["debug"]["rejected"]] == ["orb"]
    assert body["debug"]["rejected"][0]["quad"][0] == [100, 100]  # back in full-res coordinates
    assert "timingsMs" in body["debug"]


def test_scan_keeps_ambiguous_card_with_orb_support(client, rng, monkeypatch):
    from app.synth import procedural_background

    photo = procedural_background(rng, 800, 600, "paper")
    monkeypatch.setattr(detection, "detect", lambda img: _fake_detection(img, "ambiguous"))
    strong = [{"scryfallId": "fake-1", "inliers": config.VERIFY_MIN_INLIERS}]
    _stub_identify(monkeypatch, strong)

    body = _upload(client, _jpeg_bytes(photo)).json()

    assert body["count"] == 1
    assert body["cards"][0]["hashDistance"] == 14
    assert body["cards"][0]["matches"] == strong


def test_scan_keeps_unverified_card_even_without_matches(client, rng, monkeypatch):
    """Only *ambiguous* detections are gated on Stage 2: an unverified card (no index,
    or a card from a set the index lacks) is always returned."""
    from app.synth import procedural_background

    photo = procedural_background(rng, 800, 600, "paper")
    monkeypatch.setattr(detection, "detect", lambda img: _fake_detection(img, "unverified"))
    _stub_identify(monkeypatch, [])

    body = _upload(client, _jpeg_bytes(photo)).json()

    assert body["count"] == 1


def test_scan_survives_matcher_failure(client, compose_simple, fake_cards, rng, monkeypatch):
    """A crashing matcher yields a card with no matches, never a 500."""

    def boom(crop, top_n=None, *, ocr_image=None):
        raise RuntimeError("descriptor blob corrupt")

    monkeypatch.setattr(matcher, "identify_card", boom)
    image, _ = compose_simple(rng, fake_cards[:1], "paper", _PLACEMENTS[:1])

    response = _upload(client, _jpeg_bytes(image))

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["cards"][0]["matches"] == []


def test_scan_writes_intermediate_maps_when_asked(
    client, compose_simple, fake_cards, rng, monkeypatch
):
    monkeypatch.setattr(config, "DEBUG_SAVE_INTERMEDIATE", True)
    _stub_identify(monkeypatch, [])
    image, _ = compose_simple(rng, fake_cards[:1], "paper", _PLACEMENTS[:1])

    body = _upload(client, _jpeg_bytes(image)).json()

    batch_id = body["cards"][0]["id"].rsplit("_", 1)[0]
    assert (config.CARDS_DIR / f"{batch_id}_edges.jpg").is_file()
    assert (config.CARDS_DIR / f"{batch_id}_mask.jpg").is_file()  # paper is a plain surface


def test_scan_blank_photo_returns_zero_cards(client, rng, monkeypatch):
    from app.synth import procedural_background

    _stub_identify(monkeypatch, [])
    body = _upload(client, _jpeg_bytes(procedural_background(rng, 800, 600, "paper"))).json()

    assert body["count"] == 0
    assert body["cards"] == []
    assert body["debugUrl"] is not None  # overlay is still written for tuning


def test_scan_rejects_empty_upload(client):
    response = _upload(client, b"")
    assert response.status_code == 400
    assert response.json()["detail"] == "Empty upload"


def test_scan_rejects_non_image_bytes(client):
    response = _upload(client, b"this is a text file, not a photo", filename="notes.txt")
    assert response.status_code == 400
    assert "decode" in response.json()["detail"].lower()


def test_scan_requires_image_field(client):
    response = client.post("/api/scan", files={"photo": ("p.jpg", b"\xff\xd8", "image/jpeg")})
    assert response.status_code == 422  # FastAPI validation: missing ``image``

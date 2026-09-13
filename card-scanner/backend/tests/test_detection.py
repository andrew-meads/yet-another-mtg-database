"""
Tests for ``app.detection``: corner ordering, perspective warps, decoding and the
end-to-end detector on simple synthetic composites.

``order_points`` / ``four_point_transform`` are deliberately exercised through
``app.detection`` (not a geometry module) so the tests keep passing whether those
helpers live here or are re-exported from elsewhere.
"""

from __future__ import annotations

import io
import itertools

import cv2
import numpy as np
import pytest
from PIL import Image

from app import config, detection, hashing
from app.synth import procedural_background

# --- helpers -------------------------------------------------------------------


def _rotate_about_centre(pts: np.ndarray, degrees: float) -> np.ndarray:
    """Rotate a ``(4, 2)`` point set about its centroid (image coordinates)."""
    centre = pts.mean(axis=0)
    matrix = cv2.getRotationMatrix2D((float(centre[0]), float(centre[1])), degrees, 1.0)
    return cv2.transform(pts.reshape(1, 4, 2).astype(np.float32), matrix).reshape(4, 2)


def _quad_iou(a: np.ndarray, b: np.ndarray) -> float:
    """Intersection-over-union of two convex quads via ``cv2.intersectConvexConvex``."""
    a = a.astype(np.float32)
    b = b.astype(np.float32)
    inter, _ = cv2.intersectConvexConvex(a, b)
    union = cv2.contourArea(a) + cv2.contourArea(b) - inter
    return float(inter / union) if union > 0 else 0.0


def _hamming_either_orientation(crop: np.ndarray, source: np.ndarray) -> int:
    """Hamming distance between a crop and its source at 0° or 180°, whichever is closer.

    The detector normalises to portrait but cannot know up from down, so a 90° card
    may come back upside down; the matcher copes via 0°/180° variants and so do we.
    """
    db = np.array([hashing.compute_phash(source)], dtype=np.uint64)
    return int(hashing.hamming_to_array(hashing.phash_query_variants(crop), db)[0])


def _solid_background(width: int, height: int, *, light: bool) -> np.ndarray:
    """A ``solid`` procedural background of the requested brightness.

    ``procedural_background`` picks the colour at random, so try successive seeds
    until one lands on the wanted side of mid-grey.
    """
    for seed in range(100):
        bg = procedural_background(np.random.default_rng(seed), width, height, "solid")
        if (bg.mean() > 150) == light:
            return bg
    raise AssertionError("no solid background of the requested brightness in 100 seeds")


# --- order_points ----------------------------------------------------------------

_AXIS_ALIGNED = np.float32([[10, 10], [110, 10], [110, 60], [10, 60]])  # TL, TR, BR, BL


@pytest.mark.parametrize(
    "canonical",
    [_AXIS_ALIGNED, _rotate_about_centre(_AXIS_ALIGNED, 30.0)],
    ids=["axis-aligned", "rotated-30deg"],
)
def test_order_points_is_permutation_invariant(canonical):
    """All 24 input orders of the same four corners yield one identical TL/TR/BR/BL."""
    expected = detection.order_points(canonical)
    for perm in itertools.permutations(range(4)):
        got = detection.order_points(canonical[list(perm)])
        assert np.allclose(got, expected), perm
    assert expected.dtype == np.float32
    # TL -> TR -> BR -> BL must be a clockwise walk on screen (y down), which
    # OpenCV reports as a positive oriented area.
    assert cv2.contourArea(expected, oriented=True) > 0


def test_order_points_axis_aligned_corners_are_literal():
    """For an upright rectangle the labels mean exactly what they say."""
    got = detection.order_points(_AXIS_ALIGNED[[2, 0, 3, 1]])
    assert np.array_equal(got, _AXIS_ALIGNED)


# --- four_point_transform ---------------------------------------------------------


def test_four_point_transform_recovers_quadrants_and_size():
    """Warp a colour-quadrant rectangle into a canvas, then pull it back out."""
    rect_w, rect_h = 120, 80
    blue, green, red, yellow = (255, 0, 0), (0, 255, 0), (0, 0, 255), (0, 255, 255)
    rect = np.zeros((rect_h, rect_w, 3), np.uint8)
    rect[: rect_h // 2, : rect_w // 2] = blue  # TL
    rect[: rect_h // 2, rect_w // 2 :] = green  # TR
    rect[rect_h // 2 :, rect_w // 2 :] = red  # BR
    rect[rect_h // 2 :, : rect_w // 2] = yellow  # BL

    # A mildly perspective-distorted destination quad, TL/TR/BR/BL.
    quad = np.float32([[100, 80], [300, 100], [310, 260], [90, 240]])
    src = np.float32([[0, 0], [rect_w - 1, 0], [rect_w - 1, rect_h - 1], [0, rect_h - 1]])
    canvas = cv2.warpPerspective(rect, cv2.getPerspectiveTransform(src, quad), (400, 400))

    # Pass the corners shuffled: the function must reorder them itself.
    warped = detection.four_point_transform(canvas, quad[[3, 1, 0, 2]])

    tl, tr, br, bl = quad
    exp_w = round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    exp_h = round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    assert warped.shape == (exp_h, exp_w, 3)

    h, w = warped.shape[:2]
    samples = {
        "TL": (warped[h // 4, w // 4], blue),
        "TR": (warped[h // 4, 3 * w // 4], green),
        "BR": (warped[3 * h // 4, 3 * w // 4], red),
        "BL": (warped[3 * h // 4, w // 4], yellow),
    }
    for label, (pixel, colour) in samples.items():
        # Loose tolerance: two interpolating warps soften saturated colours a little.
        assert np.abs(pixel.astype(int) - np.array(colour)).max() < 40, label


# --- _normalize_to_card -----------------------------------------------------------


def test_normalize_to_card_rotates_landscape_clockwise():
    """A landscape warp becomes a portrait crop of the standard size, rotated 90° CW."""
    landscape = np.zeros((200, 300, 3), np.uint8)
    landscape[:20, :20] = (0, 0, 255)  # red marker in the top-left corner

    out = detection._normalize_to_card(landscape)

    assert out.shape == (config.OUTPUT_HEIGHT, config.OUTPUT_WIDTH, 3)
    # Clockwise rotation carries the top-left marker to the top-right.
    top_right = out[10, config.OUTPUT_WIDTH - 15]
    top_left = out[10, 10]
    assert top_right[2] > 200 and top_right[0] < 50, top_right
    assert top_left.max() < 50, top_left


def test_normalize_to_card_keeps_portrait_upright():
    """Portrait input is only resized; the marker stays top-left."""
    portrait = np.zeros((300, 200, 3), np.uint8)
    portrait[:20, :20] = (0, 0, 255)

    out = detection._normalize_to_card(portrait)

    assert out.shape == (config.OUTPUT_HEIGHT, config.OUTPUT_WIDTH, 3)
    assert out[10, 10][2] > 200


# --- load_image_bgr ---------------------------------------------------------------


def test_load_image_bgr_applies_exif_orientation_and_bgr_order():
    """EXIF orientation 6 (rotate 90° CW) swaps width/height; channels come back BGR."""
    pil = Image.new("RGB", (60, 40), (255, 0, 0))  # 60 wide, 40 tall, pure red
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation tag
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", exif=exif, quality=95)

    img = detection.load_image_bgr(buf.getvalue())

    assert img.shape == (60, 40, 3)  # rotated: 40 wide, 60 tall
    b, g, r = (int(c) for c in img[20, 20])
    assert r > 240 and b < 15 and g < 15  # red ended up in the BGR "R" slot


def test_load_image_bgr_flattens_alpha_to_three_channels():
    """RGBA PNGs must still produce an H x W x 3 array (alpha dropped)."""
    pil = Image.new("RGBA", (30, 20), (0, 255, 0, 128))
    buf = io.BytesIO()
    pil.save(buf, format="PNG")

    img = detection.load_image_bgr(buf.getvalue())

    assert img.shape == (20, 30, 3)


def test_load_image_bgr_rejects_garbage():
    with pytest.raises(ValueError, match="Could not decode"):
        detection.load_image_bgr(b"definitely not an image")


# --- detect_and_deskew on simple composites ---------------------------------------

# Non-overlapping placements on a 1600 x 1200 canvas: upright, 90° and upright.
# At scale 0.5 a card covers ~4 % of the frame, comfortably above MIN_AREA_RATIO.
_PLACEMENTS = [(300, 500, 0.0, 0.5), (800, 450, 90.0, 0.5), (1300, 600, 0.0, 0.55)]
_CANVAS = (1600, 1200)


def _background(kind: str, rng: np.random.Generator):
    if kind == "paper":
        return "paper"  # let compose_simple generate it from ``rng``
    if kind == "solid-light":
        return _solid_background(*_CANVAS, light=True)
    if kind == "solid-dark":
        return _solid_background(*_CANVAS, light=False)
    raise ValueError(kind)


@pytest.mark.parametrize("n_cards", [1, 2, 3])
@pytest.mark.parametrize("background", ["paper", "solid-light", "solid-dark"])
def test_detect_and_deskew_finds_every_card(compose_simple, fake_cards, rng, background, n_cards):
    """Each ground-truth quad is found at IoU >= 0.9, nothing extra, and each crop
    hashes within 12 bits of its source card."""
    cards = fake_cards[:n_cards]
    image, quads = compose_simple(rng, cards, _background(background, rng), _PLACEMENTS[:n_cards])

    detected = detection.detect_and_deskew(image)

    assert len(detected) == n_cards, "extra or missing detections"
    for card, truth in zip(cards, quads, strict=True):
        ious = [_quad_iou(truth, d.quad) for d in detected]
        best = int(np.argmax(ious))
        assert ious[best] >= 0.9, f"best IoU {ious[best]:.3f}"
        crop = detected[best].image
        assert crop.shape == (config.OUTPUT_HEIGHT, config.OUTPUT_WIDTH, 3)
        # The crop is a re-sampled, slightly mis-cornered copy of the source, so its
        # pHash should sit well inside the matcher's shortlist radius.
        assert _hamming_either_orientation(crop, card) <= 12


def test_detect_and_deskew_returns_quads_in_original_coordinates(compose_simple, fake_cards, rng):
    """Quads are reported in full-resolution image space, ordered TL/TR/BR/BL."""
    image, (truth,) = compose_simple(rng, fake_cards[:1], "paper", _PLACEMENTS[:1])

    (card,) = detection.detect_and_deskew(image)

    assert card.quad.shape == (4, 2)
    assert np.allclose(card.quad, detection.order_points(card.quad))
    # Upright placement: the detected TL is near the ground-truth TL (within ~1 %).
    assert np.linalg.norm(card.quad[0] - truth[0]) < 0.01 * image.shape[1]


def test_detect_and_deskew_blank_canvas_returns_nothing(rng):
    blank = procedural_background(rng, 800, 600, "paper")
    assert detection.detect_and_deskew(blank) == []


# --- DetectedCard / DetectionResult contract --------------------------------------------


def test_detected_card_positional_construction_and_defaults():
    crop = np.zeros((config.OUTPUT_HEIGHT, config.OUTPUT_WIDTH, 3), np.uint8)
    quad = np.float32([[0, 0], [10, 0], [10, 14], [0, 14]])
    card = detection.DetectedCard(crop, quad)
    assert card.image is crop and card.quad is quad
    assert card.ocr_image is None
    assert card.source == "edges"
    assert card.score == 0.0
    assert card.hash_distance is None
    assert card.orientation == 0
    assert card.verify == "unverified"


def test_detect_reports_rejections_and_timings(compose_simple, fake_cards, rng):
    image, quads = compose_simple(rng, fake_cards[:2], "paper", _PLACEMENTS[:2])

    result = detection.detect(image)

    assert len(result.cards) == 2
    assert result.n_candidates >= 2
    assert all(c.rejected for c in result.rejected)
    assert result.work_scale == pytest.approx(1000 / 1600)
    assert (
        result.timings_ms["total"]
        >= sum(v for k, v in result.timings_ms.items() if k != "total") * 0.9
    )
    # Dropping a card moves it to the rejected list in working coordinates.
    card = result.cards[0]
    result.drop(card, "orb")
    assert len(result.cards) == 1
    assert result.rejected[-1].rejected == "orb"
    assert np.allclose(
        result.rejected[-1].quad, detection.order_points(card.quad) * result.work_scale
    )


# --- draw_debug_overlay -----------------------------------------------------------


def test_draw_debug_overlay_does_not_mutate_input(compose_simple, fake_cards, rng):
    image, _ = compose_simple(rng, fake_cards[:2], "paper", _PLACEMENTS[:2])
    detected = detection.detect_and_deskew(image)
    before = image.copy()

    overlay = detection.draw_debug_overlay(image, detected)

    assert np.array_equal(image, before), "input frame was modified in place"
    assert overlay.shape == image.shape
    assert not np.array_equal(overlay, image), "overlay should have drawn something"


def test_draw_debug_overlay_accepts_a_detection_result(
    compose_simple, fake_cards, rng, monkeypatch
):
    image, _ = compose_simple(rng, fake_cards[:2], "paper", _PLACEMENTS[:2])
    result = detection.detect(image)
    assert result.rejected, "need rejected candidates to draw"

    with_rejected = detection.draw_debug_overlay(image, result)
    monkeypatch.setattr(config, "DEBUG_OVERLAY_REJECTED", False)
    without = detection.draw_debug_overlay(image, result)

    assert with_rejected.shape == image.shape
    # The rejected candidates and legend add ink that the cards-only overlay lacks.
    assert not np.array_equal(with_rejected, without)
    assert not np.array_equal(without, image)

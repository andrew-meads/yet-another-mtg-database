"""
End-to-end detector tests on synthetic composites: the no-network, no-index guard
for the whole ``detect`` path.

``app.synth.place_card`` renders a procedural card with perspective jitter, a drop
shadow and rounded corners onto every procedural background kind; ``detect`` must
return exactly that card with a quad within 1 % of the card's width. The
``refine_corners`` and ``quad_from_contour`` cases pin the geometry helpers the
pipeline leans on. The database is blocked (conftest), so verification runs in
``rank`` mode with an empty index and everything here is purely geometric.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app import config, detection, geometry
from app.synth import BACKGROUND_KINDS, place_card, procedural_background

_CANVAS = (2000, 1500)  # the regression preset's long edge


def _card_width(quad: np.ndarray) -> float:
    q = geometry.order_points(quad)
    return float(min(np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[3] - q[0])))


def _one_card(kind: str, fake_card, seed: int, *, rotation_mode: str, scale: float, dark=False):
    rng = np.random.default_rng(seed)
    canvas = procedural_background(rng, *_CANVAS, "solid" if dark else kind)
    if dark:
        canvas = np.clip(canvas.astype(np.float32) * 0.25 + rng.uniform(0, 10), 0, 60).astype(
            np.uint8
        )
    truth = place_card(
        canvas,
        fake_card(3),
        rng,
        scale_range=(scale, scale),
        rotation_mode=rotation_mode,
        perspective_jitter=0.03,
        shadow=True,
        glare=0.0,
    )
    return canvas, geometry.order_points(truth)


def _assert_single_card(
    result: detection.DetectionResult, truth: np.ndarray, label: str, *, tolerance: float = 0.01
):
    assert len(result.cards) == 1, f"{label}: {len(result.cards)} cards, rejected " + str(
        sorted({(c.rejected or "").split(":")[0] for c in result.rejected})
    )
    card = result.cards[0]
    iou = geometry.quad_iou(card.quad, truth)
    err = geometry.corner_error(card.quad, truth)
    assert iou >= 0.9, f"{label}: IoU {iou:.3f}"
    assert err <= tolerance * _card_width(truth), f"{label}: corner error {err:.1f} px"
    assert card.image.shape == (config.OUTPUT_HEIGHT, config.OUTPUT_WIDTH, 3)
    assert card.ocr_image is not None and card.ocr_image.shape[0] == 2 * config.OUTPUT_HEIGHT
    assert card.verify == "unverified" and card.hash_distance is None  # empty index


# Corner tolerance as a fraction of the card width. 1 % is what full-resolution
# refinement delivers when the border has a visible edge on every side. Two
# surfaces do not offer that: on the near-black solid the border→table step is a
# few grey levels (below anything refinement may trust over sensor noise) and on
# the playmat the side under the drop shadow meets a dark print; there the quad
# is the working-scale Canny contour, which carries ~1.3 % on its own.
_TOLERANCE = {"solid-dark": 0.015, "playmat": 0.015}


@pytest.mark.parametrize("kind", BACKGROUND_KINDS)
def test_one_upright_card_on_every_background(fake_card, kind):
    image, truth = _one_card(kind, fake_card, 100, rotation_mode="upright", scale=0.4)
    _assert_single_card(detection.detect(image), truth, kind, tolerance=_TOLERANCE.get(kind, 0.01))


def test_one_card_on_a_dark_solid(fake_card):
    image, truth = _one_card("solid", fake_card, 101, rotation_mode="upright", scale=0.4, dark=True)
    _assert_single_card(
        detection.detect(image), truth, "solid-dark", tolerance=_TOLERANCE["solid-dark"]
    )


@pytest.mark.parametrize(
    "rotation_mode,scale,seed",
    [("any90", 0.35, 200), ("small", 0.5, 201), ("any", 0.45, 202), ("upright", 0.2, 203)],
)
def test_rotated_and_scaled_cards(fake_card, rotation_mode, scale, seed):
    image, truth = _one_card("paper", fake_card, seed, rotation_mode=rotation_mode, scale=scale)
    _assert_single_card(detection.detect(image), truth, f"{rotation_mode}@{scale}")


def test_blank_canvases_yield_nothing(rng):
    for kind in ("paper", "wood", "playmat"):
        blank = procedural_background(rng, 1200, 900, kind)
        result = detection.detect(blank)
        assert result.cards == [], kind
        assert result.timings_ms["total"] > 0


def test_detect_result_bookkeeping(fake_card):
    image, _truth = _one_card("paper", fake_card, 300, rotation_mode="upright", scale=0.4)
    result = detection.detect(image)
    assert 0 < result.work_scale <= 1.0
    assert result.n_candidates == len(result.cards) + len(result.rejected)
    assert result.verify_mode == "rank"
    assert {"downscale", "edges", "color", "filter", "verify", "nms", "warp", "total"} <= set(
        result.timings_ms
    )
    assert "edges" in result.debug_images
    # Every rejected candidate carries a reason and maps back to full-res via to_json.
    for cand in result.rejected:
        assert cand.rejected
    js = result.rejected_json(limit=5)
    assert len(js) <= 5 and all("reason" not in j and j["rejected"] for j in js)
    # verify=False forces the off mode.
    assert detection.detect(image, verify=False).verify_mode == "off"


def test_detect_and_deskew_is_detect_cards(fake_card):
    image, truth = _one_card("gradient", fake_card, 301, rotation_mode="upright", scale=0.4)
    cards = detection.detect_and_deskew(image)
    assert len(cards) == 1
    assert geometry.quad_iou(cards[0].quad, truth) >= 0.9


# --- refine_corners -------------------------------------------------------------------


def _rendered_rectangle(offset: tuple[float, float, float, float] = (0, 0, 0, 0)):
    """A dark rectangle on light paper-like noise; returns (image, true quad)."""
    rng = np.random.default_rng(0)
    canvas = np.clip(rng.normal(215, 6, (900, 1200)), 0, 255).astype(np.uint8)
    canvas = cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR)
    x0, y0, x1, y1 = 300, 200, 700, 760  # 400 x 560 -> aspect 0.714
    cv2.rectangle(canvas, (x0, y0), (x1 - 1, y1 - 1), (12, 12, 12), -1)
    canvas = cv2.GaussianBlur(canvas, (3, 3), 0)
    truth = np.float32([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
    return canvas, truth


@pytest.mark.parametrize("dx,dy", [(6, 6), (-6, -6), (6, -6), (0, 6)])
def test_refine_corners_recovers_a_6px_offset_within_1px(dx, dy):
    image, truth = _rendered_rectangle()
    # Shift every corner (inward or outward, per axis) by 6 px.
    coarse = truth + np.float32([[dx, dy], [-dx, dy], [-dx, -dy], [dx, -dy]])

    refined = geometry.refine_corners(image, coarse)

    assert geometry.corner_error(refined, truth) <= 1.0
    assert np.allclose(refined, geometry.order_points(refined))


def test_refine_corners_keeps_the_input_when_there_is_no_edge():
    rng = np.random.default_rng(1)
    flat = np.full((600, 800, 3), 128, np.uint8)
    flat = np.clip(flat + rng.normal(0, 2, flat.shape), 0, 255).astype(np.uint8)
    quad = np.float32([[200, 100], [500, 100], [500, 520], [200, 520]])
    assert np.allclose(geometry.refine_corners(flat, quad), quad, atol=1e-3)


def test_refine_corners_rejects_a_wild_result(monkeypatch):
    """If the fitted lines would move a corner further than the band, the input wins."""
    image, truth = _rendered_rectangle()
    # A coarse quad far inside the rectangle: the nearest edges are outside every band.
    coarse = truth + np.float32([[120, 120], [-120, 120], [-120, -120], [120, -120]])
    refined = geometry.refine_corners(image, coarse, band_in_ratio=0.015, band_out_ratio=0.06)
    assert np.allclose(refined, geometry.order_points(coarse), atol=1e-3)


# --- warp_to_card / portrait_quad ------------------------------------------------------


def test_warp_to_card_single_resample_shapes_and_orientation():
    image = np.zeros((600, 800, 3), np.uint8)
    image[:, :] = (40, 40, 40)
    image[100:130, 100:130] = (0, 0, 255)  # red marker at the geometric top-left
    landscape = np.float32([[100, 100], [520, 100], [520, 400], [100, 400]])  # 420 x 300

    crop, hires = geometry.warp_to_card(image, landscape, config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT)

    assert crop.shape == (config.OUTPUT_HEIGHT, config.OUTPUT_WIDTH, 3)
    assert hires.shape == (2 * config.OUTPUT_HEIGHT, 2 * config.OUTPUT_WIDTH, 3)
    # Landscape -> rotated 90° clockwise: the marker ends up top-right.
    assert crop[15, config.OUTPUT_WIDTH - 15][2] > 200
    assert crop[15, 15].max() < 60

    capped_crop, capped = geometry.warp_to_card(
        image, landscape, config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT, max_hires_height=800
    )
    assert capped.shape[0] == 800 and capped_crop.shape == crop.shape


def test_portrait_quad_cycles_landscape_quads_only():
    portrait = np.float32([[0, 0], [100, 0], [100, 140], [0, 140]])
    landscape = np.float32([[0, 0], [140, 0], [140, 100], [0, 100]])
    assert np.array_equal(geometry.portrait_quad(portrait), portrait)
    assert np.array_equal(geometry.portrait_quad(landscape), landscape[[3, 0, 1, 2]])


# --- quad_from_contour ----------------------------------------------------------------


def _contour_of(mask: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return max(contours, key=cv2.contourArea)


def test_quad_from_contour_rounded_rectangle():
    from app.synth import rounded_rect_mask

    mask = np.zeros((600, 800), np.uint8)
    card = rounded_rect_mask(300, 420)
    mask[100:520, 200:500] = card
    quad = geometry.quad_from_contour(_contour_of(mask))
    assert quad is not None
    truth = np.float32([[200, 100], [500, 100], [500, 520], [200, 520]])
    # The polygon approximation cuts a 15 px-radius corner by a few px; refinement fixes that.
    assert geometry.corner_error(geometry.order_points(quad), truth) < 10.0


def test_quad_from_contour_notched_rectangle_uses_four_longest_edges():
    mask = np.zeros((600, 800), np.uint8)
    cv2.rectangle(mask, (200, 100), (499, 519), 255, -1)
    cv2.circle(mask, (500, 100), 60, 0, -1)  # a "finger" over the top-right corner
    quad = geometry.quad_from_contour(_contour_of(mask))
    assert quad is not None
    truth = np.float32([[200, 100], [500, 100], [500, 520], [200, 520]])
    assert geometry.corner_error(geometry.order_points(quad), truth) < 4.0


def test_quad_from_contour_rejects_a_triangle():
    mask = np.zeros((600, 800), np.uint8)
    cv2.fillPoly(mask, [np.int32([[100, 500], [700, 500], [400, 80]])], 255)
    assert geometry.quad_from_contour(_contour_of(mask)) is None

"""Unit tests for the pure quad geometry in ``app.geometry`` (no I/O, no DB)."""

from __future__ import annotations

import itertools
import math

import numpy as np
import pytest

from app import geometry

# --- helpers ------------------------------------------------------------------


def rect(cx: float, cy: float, w: float, h: float, angle_deg: float = 0.0) -> np.ndarray:
    """A ``w x h`` rectangle centred at ``(cx, cy)`` rotated ``angle_deg`` clockwise on screen.

    Returned in TL, TR, BR, BL order *of the unrotated rectangle*, i.e. the
    printed order if the rectangle were a card lying upright.
    """
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    half = np.array([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]])
    rot = np.array([[c, -s], [s, c]])  # image coords (y down): positive angle = clockwise
    return (half @ rot.T + np.array([cx, cy])).astype(np.float32)


def legacy_order_points(pts: np.ndarray) -> np.ndarray:
    """The original sum/difference rule, kept here as the reference for easy cases."""
    out = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    out[0] = pts[np.argmin(s)]
    out[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1)[:, 0]
    out[1] = pts[np.argmin(d)]
    out[3] = pts[np.argmax(d)]
    return out


def is_clockwise(quad: np.ndarray) -> bool:
    """Positive shoelace sum in image coordinates (y down) means clockwise on screen."""
    x, y = quad[:, 0], quad[:, 1]
    return float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) > 0


# --- order_points ---------------------------------------------------------------


@pytest.mark.parametrize("angle", [0.0, 30.0, 45.0, 60.0, -20.0, 89.0])
def test_order_points_is_permutation_invariant_and_clockwise(angle):
    quad = rect(300, 200, 140, 200, angle)
    reference = geometry.order_points(quad)
    assert reference.shape == (4, 2) and reference.dtype == np.float32
    for perm in itertools.permutations(range(4)):
        out = geometry.order_points(quad[list(perm)])
        np.testing.assert_allclose(out, reference, atol=1e-4)
    # All four corners present exactly once, in clockwise order, starting at min(x+y).
    assert len({tuple(np.round(p, 3)) for p in reference}) == 4
    assert is_clockwise(reference)
    assert np.argmin(reference.sum(axis=1)) == 0


@pytest.mark.parametrize("angle", [0.0, 10.0, 30.0, -30.0])
def test_order_points_matches_legacy_rule_on_easy_rectangles(angle):
    quad = rect(500, 400, 63 * 4, 88 * 4, angle)
    for perm in itertools.permutations(range(4)):
        pts = quad[list(perm)]
        np.testing.assert_allclose(geometry.order_points(pts), legacy_order_points(pts), atol=1e-4)


def test_order_points_fixes_the_45_degree_collapse():
    quad = rect(500, 500, 252, 352, 45.0)
    legacy = legacy_order_points(quad)
    # The old rule really does emit a duplicate corner here (documenting the bug).
    assert len({tuple(np.round(p, 3)) for p in legacy}) < 4
    fixed = geometry.order_points(quad)
    assert len({tuple(np.round(p, 3)) for p in fixed}) == 4
    assert is_clockwise(fixed)


def test_order_points_accepts_contour_shaped_input():
    quad = rect(100, 100, 40, 60).reshape(4, 1, 2).astype(np.int32)
    out = geometry.order_points(quad)
    np.testing.assert_allclose(out, rect(100, 100, 40, 60), atol=1e-4)


def test_order_points_rejects_wrong_shape():
    with pytest.raises(ValueError):
        geometry.order_points(np.zeros((3, 2)))


# --- warps ------------------------------------------------------------------------


def test_warp_size_and_four_point_transform_round_trip():
    image = np.zeros((300, 400, 3), np.uint8)
    image[50:250, 100:300] = (10, 200, 30)
    quad = np.array([[100, 50], [300, 50], [300, 250], [100, 250]], np.float32)
    assert geometry.warp_size(quad) == (200, 200)
    warped = geometry.four_point_transform(image, quad[[2, 0, 3, 1]])  # any input order
    assert warped.shape[:2] == (200, 200)
    assert (warped[5:-5, 5:-5] == (10, 200, 30)).all()


def test_warp_ordered_quad_respects_the_given_order():
    image = np.zeros((200, 200, 3), np.uint8)
    image[20:180, 20:100] = 255  # left half of the card white, right half black
    quad = np.array([[20, 20], [179, 20], [179, 179], [20, 179]], np.float32)
    upright = geometry.warp_ordered_quad(image, quad, 160, 160)
    assert upright[80, 20].max() == 255 and upright[80, 140].max() == 0
    # Rolled by two = card upside down: the white half lands on the right.
    flipped = geometry.warp_ordered_quad(image, np.roll(quad, 2, axis=0), 160, 160)
    assert flipped[80, 20].max() == 0 and flipped[80, 140].max() == 255


# --- areas / IoU / containment ----------------------------------------------------


def test_quad_area_shoelace():
    assert geometry.quad_area(rect(0, 0, 10, 20)) == pytest.approx(200.0)
    assert geometry.quad_area(rect(0, 0, 10, 20, 37.0)) == pytest.approx(200.0)


def test_quad_iou_cases():
    a = rect(50, 50, 20, 20)
    assert geometry.quad_iou(a, a) == pytest.approx(1.0)
    assert geometry.quad_iou(a, rect(500, 500, 20, 20)) == 0.0
    # Half overlap along x: inter 200, union 600 → 1/3.
    assert geometry.quad_iou(a, rect(60, 50, 20, 20)) == pytest.approx(1 / 3, abs=1e-4)
    # Nested: small inside big → inter = small area.
    assert geometry.quad_iou(a, rect(50, 50, 10, 10)) == pytest.approx(0.25, abs=1e-4)
    # Symmetric.
    assert geometry.quad_iou(a, rect(55, 52, 20, 20)) == pytest.approx(
        geometry.quad_iou(rect(55, 52, 20, 20), a), abs=1e-6
    )


def test_quad_iou_rotated_matches_analytic():
    # Two identical squares, one rotated 45°: intersection is a regular octagon.
    a = rect(0, 0, 2, 2)
    b = rect(0, 0, 2, 2, 45.0)
    inter = 4 * (2 * math.sqrt(2) - 2)  # classic result: 8(√2−1)
    assert geometry.quad_iou(a, b) == pytest.approx(inter / (8 - inter), abs=1e-3)


def test_containment_is_fraction_of_smaller():
    big = rect(50, 50, 40, 40)
    small = rect(50, 50, 10, 10)
    assert geometry.containment(big, small) == pytest.approx(1.0)
    assert geometry.containment(small, big) == pytest.approx(1.0)
    assert geometry.containment(small, rect(200, 200, 10, 10)) == 0.0
    assert geometry.containment(rect(50, 50, 10, 10), rect(55, 50, 10, 10)) == pytest.approx(0.5)


def test_degenerate_quads_do_not_divide_by_zero():
    line = np.array([[0, 0], [10, 0], [20, 0], [30, 0]], np.float32)
    assert geometry.quad_iou(line, line) == 0.0
    assert geometry.containment(line, rect(0, 0, 4, 4)) == 0.0
    assert geometry.quad_aspect(np.zeros((4, 2))) == 0.0
    assert geometry.rectangularity(10.0, np.zeros((4, 2))) == 0.0


# --- matching --------------------------------------------------------------------


def test_match_quads_greedy_one_to_one_with_decoys():
    gt = [rect(100, 100, 40, 60), rect(300, 100, 40, 60)]
    pred = [
        rect(302, 103, 40, 60),  # good match for gt[1]
        rect(100, 100, 40, 60),  # perfect for gt[0]
        rect(104, 100, 40, 60),  # decoy: overlaps gt[0] but gt[0] is taken by the better one
        rect(600, 600, 40, 60),  # far away → false positive
    ]
    matches, unmatched_pred, unmatched_gt = geometry.match_quads(pred, gt, iou_threshold=0.7)
    assert {(i, j) for i, j, _ in matches} == {(1, 0), (0, 1)}
    assert all(iou >= 0.7 for _, _, iou in matches)
    assert unmatched_pred == [2, 3]
    assert unmatched_gt == []
    # Matches are reported best-first.
    assert matches[0][2] >= matches[1][2]


def test_match_quads_threshold_and_empties():
    gt = [rect(100, 100, 40, 60)]
    pred = [rect(120, 100, 40, 60)]  # IoU 1/3
    matches, up, ug = geometry.match_quads(pred, gt, iou_threshold=0.7)
    assert matches == [] and up == [0] and ug == [0]
    matches, up, ug = geometry.match_quads(pred, gt, iou_threshold=0.3)
    assert len(matches) == 1 and up == [] and ug == []
    assert geometry.match_quads([], gt) == ([], [], [0])
    assert geometry.match_quads(pred, []) == ([], [0], [])


# --- corner error -------------------------------------------------------------------


def test_corner_error_shift_invariance_and_value():
    gt = rect(200, 200, 100, 150, 20.0)
    pred = gt + np.array([3.0, 4.0], np.float32)  # every corner off by 5 px
    assert geometry.corner_error(pred, gt) == pytest.approx(5.0, abs=1e-4)
    for shift in range(4):
        assert geometry.corner_error(np.roll(pred, shift, axis=0), gt) == pytest.approx(
            5.0, abs=1e-4
        )
    assert geometry.corner_error(gt, gt) == 0.0


# --- NMS ---------------------------------------------------------------------------


def test_nms_quads_suppresses_overlaps_keeps_best_first():
    quads = [
        rect(100, 100, 40, 60),  # score 0.5
        rect(102, 101, 40, 60),  # score 0.9 — should win over index 0
        rect(300, 300, 40, 60),  # score 0.2 — separate, kept
        rect(100, 100, 40, 60),  # score 0.9 — tie with 1, later index loses
    ]
    kept = geometry.nms_quads(quads, [0.5, 0.9, 0.2, 0.9], iou_threshold=0.5)
    assert kept == [1, 2]
    assert geometry.nms_quads([], []) == []
    with pytest.raises(ValueError):
        geometry.nms_quads(quads, [1.0])


# --- shape statistics -----------------------------------------------------------------


def test_quad_aspect_of_card_and_jittered_copy():
    card = rect(500, 500, 63 * 5, 88 * 5, 25.0)
    assert geometry.quad_aspect(card) == pytest.approx(63 / 88, abs=1e-4)
    rng = np.random.default_rng(1)
    jittered = card + rng.uniform(-4, 4, size=card.shape).astype(np.float32)
    assert abs(geometry.quad_aspect(jittered) - 63 / 88) < 0.03
    # Any cyclic order gives the same answer.
    assert geometry.quad_aspect(np.roll(card, 1, axis=0)) == pytest.approx(63 / 88, abs=1e-4)
    assert geometry.quad_aspect(rect(0, 0, 10, 10)) == pytest.approx(1.0)


def test_rectangularity():
    quad = rect(100, 100, 40, 60, 15.0)
    assert geometry.rectangularity(2400.0, quad) == pytest.approx(1.0, abs=0.02)
    assert geometry.rectangularity(1200.0, quad) == pytest.approx(0.5, abs=0.02)
    assert geometry.rectangularity(9999.0, quad) == 1.0  # clipped


def test_interior_angles():
    angles = geometry.interior_angles(rect(0, 0, 30, 50, 33.0))
    np.testing.assert_allclose(angles, 90.0, atol=1e-3)
    assert angles.sum() == pytest.approx(360.0, abs=1e-3)
    # A trapezoid: two acute and two obtuse angles, still summing to 360.
    trap = np.array([[10, 0], [20, 0], [30, 10], [0, 10]], np.float32)
    a = geometry.interior_angles(trap)
    assert a.sum() == pytest.approx(360.0, abs=1e-3)
    assert (a[:2] > 90).all() and (a[2:] < 90).all()


def test_intersect_lines():
    pt = geometry.intersect_lines((0, 0), (10, 10), (0, 10), (10, 0))
    np.testing.assert_allclose(pt, [5.0, 5.0])
    # Vertical line handled.
    pt = geometry.intersect_lines((3, -5), (3, 7), (0, 2), (1, 2))
    np.testing.assert_allclose(pt, [3.0, 2.0])
    assert geometry.intersect_lines((0, 0), (1, 1), (0, 1), (1, 2)) is None
    assert geometry.intersect_lines((0, 0), (1, 1), (2, 2), (3, 3)) is None

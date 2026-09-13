"""
Tests for ``app.candidates``: the strategies, the geometric filter with its reason
codes, the grid split, dedup and non-maximum suppression.

Everything runs on procedural images from ``app.synth`` (no network, no index).
The strategy tests run at the detector's working resolution directly (a
1000 x 750 canvas), so no downscaling is involved and the quads can be compared
with the ground truth as-is.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app import candidates as cm
from app import config, geometry
from app.synth import BACKGROUND_KINDS, procedural_background

_WORK = (1000, 750)  # (width, height) of the working canvas
_CARD_QUAD = np.float32([[300, 200], [500, 200], [500, 480], [300, 480]])  # 200 x 280 ~ 0.714


def _cand(quad, source="edges", **kw) -> cm.Candidate:
    return cm.Candidate(quad=geometry.order_points(np.float32(quad)), source=source, **kw)


def _support_for(quad: np.ndarray, shape=(750, 1000), thickness=3) -> np.ndarray:
    """A support map that contains exactly the outline of ``quad``."""
    support = np.zeros(shape, np.uint8)
    cv2.polylines(support, [np.rint(quad).astype(np.int32).reshape(-1, 1, 2)], True, 255, thickness)
    return support


# --- filter_candidates: every reason code, in order ----------------------------------


def test_filter_accepts_a_clean_card_and_scores_it_near_one():
    support = _support_for(_CARD_QUAD)
    cand = _cand(_CARD_QUAD, metrics={"contour_area": geometry.quad_area(_CARD_QUAD)})

    alive = cm.filter_candidates([cand], (750, 1000), support)

    assert alive == [cand]
    assert cand.rejected is None
    assert cand.score > 0.95
    assert cand.metrics["edge_support"] > 0.95
    assert cand.metrics["rectangularity"] == pytest.approx(1.0)


def test_filter_reason_area_for_a_speck():
    tiny = _cand([[10, 10], [30, 10], [30, 38], [10, 38]])
    cm.filter_candidates([tiny], (750, 1000), None)
    assert tiny.rejected == "area"


def test_filter_reason_area_for_a_short_side(monkeypatch):
    monkeypatch.setattr(config, "MIN_AREA_RATIO", 0.0)
    sliver = _cand([[100, 100], [130, 100], [130, 700], [100, 700]])  # 30 px wide
    cm.filter_candidates([sliver], (750, 1000), None)
    assert sliver.rejected == "area"


def test_filter_reason_concave():
    # An arrow-head shape: the fourth vertex is pushed inside the triangle.
    concave = cm.Candidate(
        quad=np.float32([[300, 200], [500, 200], [500, 480], [450, 300]]), source="edges"
    )
    cm.filter_candidates([concave], (750, 1000), None)
    assert concave.rejected == "concave"


def test_filter_reason_angles():
    # A parallelogram sheared by 50°: interior angles 40° / 140°.
    shear = 280 / np.tan(np.radians(40))
    skewed = _cand([[300, 200], [500, 200], [500 + shear, 480], [300 + shear, 480]])
    cm.filter_candidates([skewed], (750, 1000), None)
    assert skewed.rejected == "angles"


def test_filter_reason_aspect():
    square = _cand([[300, 200], [560, 200], [560, 460], [300, 460]])
    cm.filter_candidates([square], (750, 1000), None)
    assert square.rejected == "aspect"


def test_filter_reason_rect():
    # A card-shaped quad whose source contour only filled half of it.
    hollow = _cand(_CARD_QUAD, metrics={"contour_area": 0.5 * geometry.quad_area(_CARD_QUAD)})
    cm.filter_candidates([hollow], (750, 1000), _support_for(_CARD_QUAD))
    assert hollow.rejected == "rect"


def test_filter_reason_edge_support():
    unsupported = _cand(_CARD_QUAD, metrics={"contour_area": geometry.quad_area(_CARD_QUAD)})
    cm.filter_candidates([unsupported], (750, 1000), np.zeros((750, 1000), np.uint8))
    assert unsupported.rejected == "edge_support"


def test_filter_uses_preset_metrics():
    """A strategy may pre-set edge support / rectangularity (the colour twin does)."""
    twin = _cand(
        _CARD_QUAD,
        source="color+",
        metrics={"contour_area": 1.0, "edge_support": 0.9, "rectangularity": 0.95},
    )
    alive = cm.filter_candidates([twin], (750, 1000), np.zeros((750, 1000), np.uint8))
    assert alive == [twin]
    assert twin.metrics["edge_support"] == 0.9


def test_filter_skips_already_rejected():
    dead = _cand(_CARD_QUAD, rejected="hash")
    assert cm.filter_candidates([dead], (750, 1000), None) == []
    assert dead.rejected == "hash"


# --- edge_support --------------------------------------------------------------------


def test_edge_support_full_and_empty():
    support = _support_for(_CARD_QUAD)
    assert cm.edge_support(_CARD_QUAD, support) > 0.95
    shifted = _CARD_QUAD + np.float32([40, 0])
    assert cm.edge_support(shifted, support) < 0.6  # only the crossings of two sides hit


# --- dedup + nms ---------------------------------------------------------------------


def test_dedup_keeps_the_better_scored_near_duplicate():
    a = _cand(_CARD_QUAD, score=0.9)
    b = _cand(_CARD_QUAD + 2, score=0.95)  # 2 px shifted twin
    kept = cm.dedup([a, b])
    assert kept == [b]
    assert a.rejected == "dup"
    assert b.rejected is None


def test_nms_nested_unverified_keeps_the_larger():
    """Without an index the outer quad wins and the nested art box is suppressed."""
    card = _cand(_CARD_QUAD, score=0.90)
    art_box = _cand([[320, 240], [480, 240], [480, 460], [320, 460]], score=0.99)
    kept = cm.nms([art_box, card])
    assert kept == [card]
    assert art_box.rejected == "nms:1"


def test_nms_verified_beats_unverified_regardless_of_size():
    card = _cand(_CARD_QUAD, score=0.9, verify="accepted", hash_distance=4)
    sleeve = _cand(cm.expand_quad(_CARD_QUAD, 1.1, 1.1), score=0.95)  # bigger, unverified
    assert cm.nms([sleeve, card]) == [card]
    assert sleeve.rejected == "nms:1"


def test_nms_equal_hash_distance_prefers_score_over_area():
    """A sleeved card: the sleeve outline and the card outline hash the same."""
    card = _cand(_CARD_QUAD, score=0.98, verify="accepted", hash_distance=8)
    sleeve = _cand(
        cm.expand_quad(_CARD_QUAD, 1.08, 1.06), score=0.70, verify="accepted", hash_distance=8
    )
    assert cm.nms([sleeve, card]) == [card]


def test_nms_overlapping_keeps_the_better_hash():
    a = _cand(_CARD_QUAD, score=0.9, verify="accepted", hash_distance=6)
    b = _cand(_CARD_QUAD + np.float32([30, 0]), score=0.9, verify="accepted", hash_distance=2)
    assert geometry.quad_iou(a.quad, b.quad) >= config.NMS_IOU
    assert cm.nms([a, b]) == [b]
    assert a.rejected == "nms:1"


def test_nms_disjoint_quads_both_survive():
    a = _cand(_CARD_QUAD)
    b = _cand(_CARD_QUAD + np.float32([400, 0]))
    assert set(map(id, cm.nms([a, b]))) == {id(a), id(b)}


def test_nms_unhashed_twin_ranks_last():
    parent = _cand(_CARD_QUAD, source="color", score=0.9)
    twin = _cand(cm.expand_quad(_CARD_QUAD, 63 / 57, 88 / 82), source="color+", score=0.9)
    assert cm.nms([twin, parent]) == [parent]


# --- expand_quad ---------------------------------------------------------------------


def test_expand_quad_scales_short_and_long_axes_separately():
    grown = cm.expand_quad(_CARD_QUAD, 63 / 57, 88 / 82)
    width = np.linalg.norm(grown[1] - grown[0])
    height = np.linalg.norm(grown[3] - grown[0])
    assert width == pytest.approx(200 * 63 / 57, rel=1e-3)
    assert height == pytest.approx(280 * 88 / 82, rel=1e-3)
    assert np.allclose(grown.mean(axis=0), _CARD_QUAD.mean(axis=0))


# --- grid split ----------------------------------------------------------------------

_ROW_2x1 = np.float32(
    [[100, 100], [100 + 2 * 126, 100], [100 + 2 * 126, 100 + 176], [100, 100 + 176]]
)


def test_grid_shape_recognises_rows_and_flags_the_two_tile_ambiguity():
    assert cm.grid_shape(_ROW_2x1) == (2, 1)
    three = np.float32([[0, 0], [3 * 63, 0], [3 * 63, 88], [0, 88]]) * 3
    assert cm.grid_shape(three) == (3, 1)
    # A lone card has the proportions of two sideways cards stacked (88 : 126 vs
    # 63 : 88), so it matches a two-tile shape — never a three-tile one. That is
    # why split_merged demands seam evidence and prune_split_children exists.
    assert cm.grid_shape(_CARD_QUAD) in ((1, 2), (2, 1))
    tall = np.float32([[0, 0], [63, 0], [63, 3 * 88], [0, 3 * 88]]) * 3
    assert cm.grid_shape(tall) == (1, 3)


def test_split_merged_tiles_a_two_by_one_row_when_the_seam_is_supported():
    parent = _cand(_ROW_2x1, params={"blur": 5})
    support = _support_for(_ROW_2x1)
    seam_x = 100 + 126
    cv2.line(support, (seam_x, 100), (seam_x, 276), 255, 3)

    children = cm.split_merged(parent, support)

    assert len(children) == 2
    for child in children:
        assert child.source == "split"
        assert child.parent is parent
        assert child.params == {"blur": 5}
        assert geometry.quad_aspect(child.quad) == pytest.approx(126 / 176, abs=0.01)
        assert geometry.containment(child.quad, parent.quad) > 0.99
    assert geometry.quad_iou(children[0].quad, children[1].quad) < 0.01
    assert cm.seam_support(parent.quad, 2, 1, support) > 0.9


def test_split_merged_needs_seam_evidence():
    parent = _cand(_ROW_2x1)
    assert cm.split_merged(parent, _support_for(_ROW_2x1)) == []


def test_prune_split_children_when_parent_survives():
    parent = _cand(_ROW_2x1)
    support = _support_for(_ROW_2x1)
    cv2.line(support, (226, 100), (226, 276), 255, 3)
    children = cm.split_merged(parent, support)
    cm.prune_split_children([parent, *children])
    assert all(c.rejected == "split" for c in children)

    parent.rejected = "hash"
    for c in children:
        c.rejected = None
    cm.prune_split_children([parent, *children])
    assert all(c.rejected is None for c in children)


# --- strategies on procedural backgrounds ------------------------------------------


def _work_composite(rng, kind: str, fake_card, *, dark: bool = False):
    """One fake card (upright, ~35 % of the height) on a working-size canvas."""
    from conftest import compose_simple

    if dark:
        canvas = procedural_background(rng, *_WORK, "solid")
        canvas = np.clip(canvas.astype(np.float32) * 0.2, 0, 50).astype(np.uint8)
    else:
        canvas = procedural_background(rng, *_WORK, kind)
    image, (truth,) = compose_simple(rng, [fake_card(1)], canvas, [(500, 375, 0.0, 0.4)])
    return image, geometry.order_points(truth)


def _best_iou(cands, truth) -> float:
    return max((geometry.quad_iou(c.quad, truth) for c in cands), default=0.0)


@pytest.mark.parametrize("kind", BACKGROUND_KINDS)
def test_edge_candidates_find_the_card_on_every_background(fake_card, kind):
    rng = np.random.default_rng(7)
    image, truth = _work_composite(rng, kind, fake_card)

    out = cm.edge_candidates(image)

    assert out.support.shape == image.shape[:2]
    assert out.support.dtype == np.uint8
    assert _best_iou(out.candidates, truth) >= 0.9, kind
    assert len(out.candidates) <= 16 * config.MAX_CANDIDATES_PER_STRATEGY


def test_edge_candidates_fixed_mode_still_finds_the_card(fake_card, monkeypatch):
    monkeypatch.setattr(config, "CANNY_MODE", "fixed")
    image, truth = _work_composite(np.random.default_rng(3), "paper", fake_card)
    out = cm.edge_candidates(image)
    assert _best_iou(out.candidates, truth) >= 0.9
    assert all(c.params["sigma"] == "fixed" for c in out.candidates)


def test_edge_candidates_find_the_card_on_a_dark_solid(fake_card):
    image, truth = _work_composite(np.random.default_rng(5), "solid", fake_card, dark=True)
    assert _best_iou(cm.edge_candidates(image).candidates, truth) >= 0.9


def test_color_mask_candidates_emit_parent_and_expanded_twin(fake_card):
    image, truth = _work_composite(np.random.default_rng(11), "solid", fake_card, dark=True)

    out = cm.color_mask_candidates(image)

    sources = {c.source for c in out.candidates}
    assert sources == {"color", "color+"}
    parents = [c for c in out.candidates if c.source == "color"]
    twins = [c for c in out.candidates if c.source == "color+"]
    assert len(parents) == len(twins)
    # The twin inherits its parent's support metrics and is bigger by the border ratios.
    best_parent = max(parents, key=lambda c: geometry.quad_iou(c.quad, truth))
    assert geometry.quad_iou(best_parent.quad, truth) >= 0.85
    twin = twins[parents.index(best_parent)]
    assert twin.metrics["edge_support"] == best_parent.metrics["edge_support"]
    assert twin.area == pytest.approx(best_parent.area * (63 / 57) * (88 / 82), rel=0.02)
    assert "mask" in out.debug


def test_color_mask_skipped_on_a_patterned_surface(fake_card):
    rng = np.random.default_rng(2)
    image, _ = _work_composite(rng, "playmat", fake_card)
    _median, spread = cm.background_model(image)
    assert spread > config.BG_MAX_SPREAD
    assert cm.color_mask_candidates(image).candidates == []


def test_color_mask_modes(fake_card, monkeypatch):
    image, _ = _work_composite(np.random.default_rng(2), "playmat", fake_card)
    monkeypatch.setattr(config, "BG_MODE", "always")
    assert isinstance(cm.color_mask_candidates(image).candidates, list)  # runs, whatever it finds
    monkeypatch.setattr(config, "BG_MODE", "off")
    solid, _ = _work_composite(np.random.default_rng(4), "solid", fake_card)
    assert cm.color_mask_candidates(solid).candidates == []


def test_candidate_to_json_scales_quad():
    cand = _cand(_CARD_QUAD, params={"blur": 5}, metrics={"aspect": 0.7142}, hash_distance=3)
    js = cand.to_json(2.0)
    assert js["quad"][0] == [600, 400]
    assert js["params"] == {"blur": 5}
    assert js["metrics"]["aspect"] == 0.714
    assert js["hashDistance"] == 3

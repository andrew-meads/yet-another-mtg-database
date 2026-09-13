"""Unit tests for the edge-run rules behind ``geometry.refine_corners``.

Profiles are hand-built intensity sequences along a side's outward normal
(index 0 at the inward limit, ``zero`` at the coarse line), so each rule can be
pinned without an image: the frame→border drop beside an inset line, a
glare-washed foil border, a neighbouring card across a paper gap, a drop shadow
and a texture ripple.
"""

from __future__ import annotations

import numpy as np
import pytest

from app import geometry

SPAN = 6
STEPS = np.arange(-40.0, 71.0, 1.0)  # inward limit -40 ... outward reach +70
ZERO = int(np.count_nonzero(STEPS < 0))  # index of the coarse line


def _profile(segments: list[tuple[int, float]]) -> np.ndarray:
    """Piecewise-constant profile from ``(length, level)`` segments, ``len(STEPS)`` long."""
    out = np.concatenate([np.full(n, v, dtype=np.float32) for n, v in segments])
    assert out.size == STEPS.size, out.size
    return out


def _qualifies(prof: np.ndarray, pos: float, **kw) -> bool:
    return geometry._edge_run_qualifies(prof, STEPS, SPAN, ZERO, pos, 20.0, 5.0, **kw)


def test_frame_hugging_line_takes_the_border_edge_not_the_frame_drop():
    # inward: art 150 (34 px), frame 200 (6 px) | outward: border 30 (34 px), table 120 (37 px)
    prof = _profile([(34, 150), (6, 200), (34, 30), (37, 120)])
    assert _qualifies(prof, 34.0)  # border→table, one border width out
    assert not _qualifies(prof, 0.0)  # frame→border at the line is bright→dark
    assert not _qualifies(prof, -6.0)


def test_washed_foil_border_with_a_sparkle_still_qualifies():
    # a glare-washed border at 100 with one dark sparkle inside; table 190 beyond
    prof = _profile([(20, 100), (2, 40), (18, 100), (30, 100), (41, 190)])
    assert _qualifies(prof, 30.0, inside_tolerance=40.0)
    assert _qualifies(prof, 30.0, inside_tolerance=5.0)  # a 2 px sparkle never sets the level
    # ... but a border brighter than what lies inside needs the wider inside tolerance
    brighter = _profile([(40, 60), (30, 100), (41, 190)])
    assert _qualifies(brighter, 30.0, inside_tolerance=40.0)
    assert not _qualifies(brighter, 30.0, inside_tolerance=20.0)


def test_neighbour_across_a_paper_gap_is_refused():
    # line on the true edge: border 30 inside; paper 230 (12 px), neighbour border 30 (30 px), frame 200
    prof = _profile([(40, 30), (12, 230), (30, 30), (29, 200)])
    assert not _qualifies(prof, 42.0)  # neighbour border→frame: reached across the gap
    assert _qualifies(prof, 0.0)  # this card's own edge at the line


def test_drop_shadow_is_refused():
    # border 30 inside; shadow 110 (25 px) then table 220
    prof = _profile([(40, 30), (25, 110), (46, 220)])
    assert not _qualifies(prof, 25.0, inside_tolerance=40.0)
    assert _qualifies(prof, 0.0)


def test_ripple_beside_the_line_is_not_an_edge():
    # border 30, a texture step to 41 at the line, the real table 130 further out
    prof = _profile([(40, 30), (20, 41), (51, 130)])
    assert not _qualifies(prof, 0.0)  # 11 levels against a 100-level contrast
    assert _qualifies(prof, 20.0)


def test_slow_ramp_into_a_dark_region_is_refused():
    # the line sits on the edge; beyond it a shadow ramps down over 40 px onto a dark plateau
    ramp = np.linspace(90, 25, 40, dtype=np.float32)
    prof = np.concatenate([np.full(40, 90, np.float32), ramp, np.full(31, 60, np.float32)])
    assert not _qualifies(prof, 40.0)


@pytest.mark.parametrize("kind", ["solid-mid", "playmat"])
def test_refine_corners_recovers_a_full_border_inset(kind):
    """A coarse quad on the inner edge of a black border ends on the outer edge."""
    from app import synth

    rng = np.random.default_rng(3)
    card = synth.make_fake_card(rng, 5)
    if kind == "solid-mid":
        canvas = np.full((1200, 1600, 3), 130, np.uint8)
    else:
        canvas = synth.procedural_background(rng, 1600, 1200, "playmat")
    truth = np.float32([[400, 200], [1000, 200], [1000, 1040], [400, 1040]])
    synth.render_card(canvas, card, truth, rng, shadow=False, glare=0.0)
    border = 0.034 * 840  # the fake card's black border, ~3.4 % of the long edge
    inset = truth + np.float32(
        [[border, border], [-border, border], [-border, -border], [border, -border]]
    )
    refined = geometry.refine_corners(canvas, inset)
    err = geometry.corner_error(refined, truth)
    assert err <= 3.0, f"{kind}: corner error {err:.1f} px"

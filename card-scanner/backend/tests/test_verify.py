"""
Tests for ``app.verify``: pHash verification of candidates against a fake index.

The ``fake_index`` fixture (conftest) installs the hashes of twelve procedural
cards into the matcher's Stage-1 cache, so ``matcher.nearest_hash_distance``
works with zero database access. Composites place those same cards on a
background; a candidate on a card must verify, a candidate on bare background
must not, and the winning hash variant must reveal an upside-down card.
"""

from __future__ import annotations

import numpy as np
import pytest

from app import config, geometry, matcher, verify
from app.candidates import Candidate

_CANVAS = (1000, 750)


def _composite(compose_simple, fake_cards, rng, *, angle: float = 0.0):
    """Card 2 on a paper canvas at working size; returns (image, truth quad)."""
    image, (truth,) = compose_simple(
        rng, [fake_cards[2]], "paper", [(500, 375, angle, 0.4)], size=_CANVAS
    )
    return image, geometry.order_points(truth)


def _background_rect() -> np.ndarray:
    """A card-shaped quad over bare paper (top-left corner of the canvas)."""
    return np.float32([[20, 20], [160, 20], [160, 216], [20, 216]])


# --- warp_small ------------------------------------------------------------------


def test_warp_small_is_portrait_at_the_configured_size(compose_simple, fake_cards, rng):
    image, truth = _composite(compose_simple, fake_cards, rng)
    thumb = verify.warp_small(image, truth)
    assert thumb.shape[0] == config.VERIFY_THUMB_LONG_EDGE
    assert thumb.shape[1] == round(config.VERIFY_THUMB_LONG_EDGE * config.CARD_ASPECT_RATIO)
    # A sideways card comes out portrait too.
    image90, truth90 = _composite(compose_simple, fake_cards, rng, angle=90.0)
    assert verify.warp_small(image90, truth90, 120).shape[:2] == (
        120,
        round(120 * config.CARD_ASPECT_RATIO),
    )


# --- effective_mode ------------------------------------------------------------------


def test_effective_mode_auto_is_rank_for_a_small_index(fake_index):
    assert matcher.index_size() < config.VERIFY_MIN_INDEX_SIZE
    assert verify.effective_mode("auto") == "rank"


def test_effective_mode_auto_is_filter_for_a_big_index(fake_index, monkeypatch):
    monkeypatch.setattr(config, "VERIFY_MIN_INDEX_SIZE", 1)
    assert verify.effective_mode("auto") == "filter"


def test_effective_mode_auto_is_rank_when_the_index_is_unreachable(monkeypatch):
    def boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(matcher, "index_size", boom)
    assert verify.effective_mode("auto") == "rank"


def test_effective_mode_passthrough_and_unknown(monkeypatch):
    assert verify.effective_mode("off") == "off"
    assert verify.effective_mode("filter") == "filter"
    monkeypatch.setattr(config, "VERIFY_MODE", "bogus")
    assert verify.effective_mode() in ("rank", "filter")  # unknown -> auto


# --- hash_verify zones ---------------------------------------------------------------


def test_filter_mode_accepts_card_and_rejects_background(
    compose_simple, fake_cards, rng, fake_index
):
    image, truth = _composite(compose_simple, fake_cards, rng)
    on_card = Candidate(quad=truth, source="edges")
    on_paper = Candidate(quad=_background_rect(), source="edges")

    mode = verify.hash_verify([on_card, on_paper], image, mode="filter")

    assert mode == "filter"
    assert on_card.verify == "accepted"
    assert on_card.hash_distance is not None and on_card.hash_distance <= config.VERIFY_MAX_HAMMING
    assert on_card.orientation == 0
    assert on_paper.verify == "rejected"
    assert on_paper.rejected == "hash"
    assert on_paper.hash_distance > config.VERIFY_AMBIGUOUS_HAMMING


def test_filter_mode_ambiguous_zone(compose_simple, fake_cards, rng, fake_index, monkeypatch):
    """Distances between the two thresholds are ambiguous, not rejected."""
    image, truth = _composite(compose_simple, fake_cards, rng)
    cand = Candidate(quad=truth, source="edges")
    verify.hash_verify([cand], image, mode="filter")
    d = cand.hash_distance
    # Re-zone by moving the thresholds around the measured distance.
    monkeypatch.setattr(config, "VERIFY_MAX_HAMMING", d - 1)
    monkeypatch.setattr(config, "VERIFY_AMBIGUOUS_HAMMING", d + 1)
    cand2 = Candidate(quad=truth, source="edges")
    verify.hash_verify([cand2], image, mode="filter")
    assert cand2.verify == "ambiguous"
    assert cand2.rejected is None


def test_rank_mode_never_rejects_nor_marks_ambiguous(
    compose_simple, fake_cards, rng, fake_index, monkeypatch
):
    """A partial index must not drop cards from sets it lacks: in rank mode a far
    candidate stays unverified (with its distance recorded for ordering)."""
    image, truth = _composite(compose_simple, fake_cards, rng)
    on_card = Candidate(quad=truth, source="edges")
    on_paper = Candidate(quad=_background_rect(), source="edges")

    verify.hash_verify([on_card, on_paper], image, mode="rank")

    assert on_card.verify == "accepted"
    assert on_paper.verify == "unverified"
    assert on_paper.rejected is None
    assert on_paper.hash_distance is not None

    # Even inside the "ambiguous" band nothing becomes ambiguous in rank mode.
    monkeypatch.setattr(config, "VERIFY_MAX_HAMMING", on_card.hash_distance - 1)
    monkeypatch.setattr(config, "VERIFY_AMBIGUOUS_HAMMING", on_card.hash_distance + 1)
    again = Candidate(quad=truth, source="edges")
    verify.hash_verify([again], image, mode="rank")
    assert again.verify == "unverified"


def test_off_mode_hashes_nothing(compose_simple, fake_cards, rng, fake_index):
    image, truth = _composite(compose_simple, fake_cards, rng)
    cand = Candidate(quad=truth, source="edges")
    assert verify.hash_verify([cand], image, mode="off") == "off"
    assert cand.hash_distance is None and cand.verify == "unverified"


def test_empty_index_is_a_no_op(compose_simple, fake_cards, rng):
    """No ``fake_index``: the matcher cache is empty and the DB is blocked."""
    image, truth = _composite(compose_simple, fake_cards, rng)
    cand = Candidate(quad=truth, source="edges")
    mode = verify.hash_verify([cand], image, mode="filter")
    assert mode == "filter"
    assert cand.verify == "unverified"
    assert cand.rejected is None
    assert cand.hash_distance is None


def test_matcher_failure_never_raises(compose_simple, fake_cards, rng, fake_index, monkeypatch):
    def boom(crop):
        raise RuntimeError("pool exhausted")

    monkeypatch.setattr(matcher, "nearest_hash_distance", boom)
    image, truth = _composite(compose_simple, fake_cards, rng)
    cand = Candidate(quad=truth, source="edges")
    verify.hash_verify([cand], image, mode="filter")
    assert cand.verify == "unverified" and cand.rejected is None


def test_rejected_candidates_are_skipped(compose_simple, fake_cards, rng, fake_index):
    image, truth = _composite(compose_simple, fake_cards, rng)
    dead = Candidate(quad=truth, source="edges", rejected="area")
    verify.hash_verify([dead], image, mode="filter")
    assert dead.hash_distance is None


# --- orientation from the winning variant -------------------------------------------


@pytest.mark.parametrize("angle,expected", [(0.0, 0), (180.0, 180), (90.0, None), (270.0, None)])
def test_orientation_follows_the_hash_variant(
    compose_simple, fake_cards, rng, fake_index, angle, expected
):
    """An upside-down card matches its index hash through the 180° variant. For the
    sideways placements the portrait rule decides which way is up, so either
    variant is legitimate — but the card must still be accepted."""
    image, truth = _composite(compose_simple, fake_cards, rng, angle=angle)
    cand = Candidate(quad=truth, source="edges")
    verify.hash_verify([cand], image, mode="filter")
    assert cand.verify == "accepted", cand.hash_distance
    if expected is not None:
        assert cand.orientation == expected
    else:
        assert cand.orientation in (0, 180)


# --- orb_gate ------------------------------------------------------------------


class _Card:
    def __init__(self, verify):
        self.verify = verify


def test_orb_gate_drops_weak_matches_only_in_filter_mode(monkeypatch):
    from app import config, verify

    strong = [{"inliers": 40}]
    weak = [{"inliers": 0}]
    monkeypatch.setattr(config, "VERIFY_ORB_GATE", "all")
    monkeypatch.setattr(verify, "effective_mode", lambda mode=None: "filter")
    assert verify.orb_gate(_Card("accepted"), strong)
    assert not verify.orb_gate(_Card("accepted"), weak)
    assert not verify.orb_gate(_Card("accepted"), [])
    assert not verify.orb_gate(_Card("ambiguous"), weak)
    # rank mode (small index): only hash-ambiguous candidates are dropped
    monkeypatch.setattr(verify, "effective_mode", lambda mode=None: "rank")
    assert verify.orb_gate(_Card("accepted"), weak)
    assert not verify.orb_gate(_Card("ambiguous"), weak)
    # ambiguous-only policy
    monkeypatch.setattr(verify, "effective_mode", lambda mode=None: "filter")
    monkeypatch.setattr(config, "VERIFY_ORB_GATE", "ambiguous")
    assert verify.orb_gate(_Card("accepted"), weak)

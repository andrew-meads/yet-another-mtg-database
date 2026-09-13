"""
Tests for ``app.matcher`` against the in-memory ``fake_index`` (see conftest).

Every test here runs both real stages — pHash shortlist and ORB + RANSAC re-rank —
with only the database calls replaced.
"""

from __future__ import annotations

import time

import cv2
import numpy as np
import pytest

from app import config, hashing, index_db, matcher


def _query(fake_index, jitter, row_id: int, seed: int | None = None) -> np.ndarray:
    """A jittered query built from the source image of ``row_id``."""
    return jitter(
        fake_index.images[row_id], np.random.default_rng(seed if seed is not None else row_id)
    )


# --- ranking --------------------------------------------------------------------------


def test_every_distinct_card_is_top1_strict(fake_index, jitter):
    """A jittered crop of each indexed card ranks its own printing first."""
    for row_id in fake_index.distinct_ids:
        results = matcher.identify(_query(fake_index, jitter, row_id))
        assert results, row_id
        assert results[0]["scryfallId"] == fake_index.rows[row_id]["scryfall_id"], row_id
        assert results[0]["inliers"] >= config.MIN_INLIERS


def test_upside_down_query_is_still_top1(fake_index, jitter):
    """Part 1 cannot tell up from down; the 180° pHash variant plus rotation-tolerant
    ORB features keep a flipped crop on its own card."""
    flipped = cv2.rotate(_query(fake_index, jitter, 5), cv2.ROTATE_180)

    results = matcher.identify(flipped)

    assert results[0]["scryfallId"] == "fake-5"


def test_clean_query_is_confident(fake_index, jitter):
    results = matcher.identify(_query(fake_index, jitter, 2))

    best = results[0]
    assert best["scryfallId"] == "fake-2"
    assert best["confident"] is True
    assert best["inliers"] >= config.MIN_INLIERS
    # Runner-up is an unrelated card and well below the 2x confidence margin.
    assert results[1]["inliers"] * config.CONFIDENT_MARGIN <= best["inliers"]


def test_result_shape(fake_index, jitter):
    results = matcher.identify(_query(fake_index, jitter, 0), top_n=1)

    (best,) = results
    assert set(best) == {
        "scryfallId",
        "name",
        "set",
        "collectorNumber",
        "face",
        "hammingDistance",
        "featureScore",
        "inliers",
        "confident",
        "imageUrl",
        "scryfallUri",
        "goodMatches",
        "rotation",
        "confidenceRule",
        "fusedScore",
        "nameMatch",
        "collectorMatch",
        "shortlistSources",
    }
    assert best["set"] == "fak" and best["face"] == "single"
    assert isinstance(best["hammingDistance"], int)


# --- confidence margin -----------------------------------------------------------------


def test_sibling_printing_does_not_break_confidence(fake_index, jitter):
    """A near-tie with another printing of the SAME card (same oracle_id) is not
    ambiguity: the top match stays confident."""
    results = matcher.identify(_query(fake_index, jitter, 3))

    best, runner_up = results[0], results[1]
    assert best["scryfallId"] == "fake-3"
    assert runner_up["scryfallId"] == "fake-3-alt"
    # The sibling really is close — closer than the margin would tolerate for a
    # different card — which is what makes this test meaningful.
    assert runner_up["inliers"] > best["inliers"] / config.CONFIDENT_MARGIN
    assert best["confident"] is True


def test_unrelated_near_tie_drops_confidence(fake_index, jitter):
    """Inject a competitor with card 3's exact descriptors under a different oracle_id:
    the same near-tie now signals ambiguity and the top match must not be confident."""
    competitor_id = max(fake_index.rows) + 1
    fake_index.rows[competitor_id] = {
        **fake_index.rows[3],
        "id": competitor_id,
        "scryfall_id": "fake-competitor",
        "oracle_id": "oracle-competitor",
    }
    fake_index.install()

    results = matcher.identify(_query(fake_index, jitter, 3))

    best = results[0]
    # Identical descriptors: which of the two wins depends on RANSAC noise, but
    # neither may be reported as confident.
    assert best["scryfallId"] in {"fake-3", "fake-competitor"}
    assert best["inliers"] >= config.MIN_INLIERS
    assert best["confident"] is False


# --- degenerate index states -----------------------------------------------------------


def test_empty_index_returns_nothing(fake_index, jitter):
    fake_index.rows.clear()
    fake_index.install()

    assert matcher.identify(_query(fake_index, jitter, 0)) == []
    assert matcher.identify_with_shortlist(_query(fake_index, jitter, 0)) == ([], [])


def test_blocked_database_presents_empty_index_fast(fake_card):
    """With no fake index installed the real ``_ensure_loaded`` runs, hits the blocked
    pool, and must degrade to an empty index immediately (no pool timeout)."""
    started = time.monotonic()

    results = matcher.identify(fake_card(0))

    assert results == []
    assert matcher.index_size() == 0
    assert time.monotonic() - started < 2.0


def test_shortlist_ids_missing_from_rows_returns_no_match(fake_index, jitter, monkeypatch):
    """Regression: during a wipe-and-rebuild the cached ids may all be gone from the
    table, so ``load_rows`` returns ``{}``; that must be "no match", not IndexError."""
    monkeypatch.setattr(index_db, "load_rows", lambda conn, ids: {})

    shortlist, results = matcher.identify_with_shortlist(_query(fake_index, jitter, 0))

    assert results == []
    assert len(shortlist) == len(fake_index.rows)  # Stage 1 still ran
    assert matcher.identify(_query(fake_index, jitter, 0)) == []


# --- top_n / shortlist ------------------------------------------------------------------


@pytest.mark.parametrize("top_n", [1, 2, 4])
def test_top_n_is_respected(fake_index, jitter, top_n):
    results = matcher.identify(_query(fake_index, jitter, 1), top_n=top_n)
    assert len(results) == top_n


def test_default_top_n_comes_from_config(fake_index, jitter, monkeypatch):
    monkeypatch.setattr(config, "TOP_N_MATCHES", 3)
    assert len(matcher.identify(_query(fake_index, jitter, 1))) == 3


def test_shortlist_is_capped_and_sorted_by_hamming(fake_index, jitter, monkeypatch):
    monkeypatch.setattr(config, "SHORTLIST_K", 5)
    query = _query(fake_index, jitter, 7)

    shortlist, results = matcher.identify_with_shortlist(query)

    assert len(shortlist) == 5
    assert len(set(shortlist)) == 5
    variants = hashing.phash_query_variants(query)
    distances = [
        int(
            hashing.hamming_to_array(
                variants,
                np.array([int.from_bytes(fake_index.rows[i]["phash"], "big")], np.uint64),
            )[0]
        )
        for i in shortlist
    ]
    assert distances == sorted(distances)
    assert 7 in shortlist  # the true card survived Stage 1
    assert results[0]["scryfallId"] == "fake-7"
    # Nothing outside the shortlist can be returned by Stage 2.
    returned = {r["scryfallId"] for r in results}
    assert returned <= {fake_index.rows[i]["scryfall_id"] for i in shortlist}

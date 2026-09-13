"""
Matcher tests for the OCR-assisted path: union shortlist, fusion, confidence rules
and orientation — with a fake OCR engine and a fake name table, no models, no DB.

The ``fake_index`` fixture (conftest) primes the matcher with 13 fake cards but no
text metadata; these tests add a :class:`index_db.Stage1Data` + ``NameTable`` for
those rows and script what "OCR" reads, so each rung of the fallback ladder can be
exercised deterministically.
"""

from __future__ import annotations

import numpy as np
import pytest

from app import config, index_db, matcher, names, ocr


def _stage1_for(fake_index) -> index_db.Stage1Data:
    """Text metadata for the fake rows: name "Fake Card fake-N", set FAK, number N."""
    ids = matcher._cache["ids"]
    rows = [fake_index.rows[int(i)] for i in ids]
    name_keys = [names.normalize_key(r["name"]) for r in rows]
    cn = [names.normalize_collector_number(r["collector_number"]) for r in rows]
    return index_db.Stage1Data(
        ids=ids,
        hashes=matcher._cache["hashes"],
        name_key=name_keys,
        face_name_keys=[[k] for k in name_keys],
        set_code=[r["set_code"] for r in rows],
        cn_norm=[c[0] for c in cn],
        cn_base=[c[1] for c in cn],
        oracle_id=[r["oracle_id"] for r in rows],
    )


@pytest.fixture
def text_index(fake_index):
    """Attach a Stage1Data + NameTable to the primed fake index."""
    stage1 = _stage1_for(fake_index)
    matcher._cache["stage1"] = stage1
    matcher._cache["names"] = matcher._build_name_table(stage1)
    return fake_index


class FakeEngine:
    """Scripted OCR: always returns the same lines / votes."""

    band_passes = True  # the matcher consults this to decide lazy band passes

    def __init__(self, lines, votes=None, band_lines=()):
        self._lines = lines
        self._band_lines = list(band_lines)
        self._votes = votes or {0: 0.0, 180: 0.0}
        self.calls = 0
        self.band_calls = 0

    def read_bands(self, crop, ocr_image=None, *, into):
        self.band_calls += 1
        into.lines.extend(
            ocr.OcrLine(t, c, np.zeros((4, 2), np.float32), 20.0, 120.0, 0.97, "band_bottom", False)
            for t, c in self._band_lines
        )
        return into

    def read_card(self, crop, ocr_image=None, *, band_passes=None):
        self.calls += 1
        made = [
            ocr.OcrLine(t, c, np.zeros((4, 2), np.float32), 30.0, 200.0, 0.05, "full", False)
            for t, c in self._lines
        ]
        return ocr.OcrResult(made, dict(self._votes), {"total": 1.0})


def _use_engine(monkeypatch, engine):
    monkeypatch.setattr(config, "OCR_ENABLED", True)
    monkeypatch.setattr(ocr, "get_engine", lambda: engine)


def _row_for(fake_index, scryfall_id):
    return next(r for r in fake_index.rows.values() if r["scryfall_id"] == scryfall_id)


def test_no_ocr_engine_keeps_legacy_ranking(text_index, jitter, rng, monkeypatch):
    """With OCR unavailable the result is the pure pHash → ORB ranking."""
    monkeypatch.setattr(ocr, "get_engine", lambda: None)
    q = jitter(text_index.images[0], rng)
    res = matcher.identify_card(q)
    assert res.matches[0]["scryfallId"] == "fake-0"
    assert res.ocr is None
    assert all(m["shortlistSources"] == ["hash"] for m in res.matches)


def test_name_read_adds_rows_and_reports_match(text_index, jitter, rng, monkeypatch):
    engine = FakeEngine([("Fake Card fake-5", 0.98), ("Creature - Synthetic", 0.95)])
    _use_engine(monkeypatch, engine)
    monkeypatch.setattr(config, "SHORTLIST_K", 1)  # hash shortlist too small to hold card 5
    q = jitter(text_index.images[5], rng)
    res = matcher.identify_card(q)
    assert engine.calls == 1
    best = res.matches[0]
    assert best["scryfallId"] == "fake-5"
    assert "name" in best["shortlistSources"]
    assert best["nameMatch"]["key"] == "fake card fake 5"
    assert res.ocr["name"]["key"] == "fake card fake 5"


def test_name_alone_cannot_overturn_a_strong_orb_win(text_index, jitter, rng, monkeypatch):
    """A misread name (bonus ≤ 12) never beats ~40+ validated inliers."""
    _use_engine(monkeypatch, FakeEngine([("Fake Card fake-9", 0.9)]))
    q = jitter(text_index.images[0], rng)
    res = matcher.identify_card(q)
    assert res.matches[0]["scryfallId"] == "fake-0"
    # "fake-9" is one character off "fake-0", so fuzzy matching credits both; the
    # bonus is identical for the two and the validated inliers decide.
    by_id = {m["scryfallId"]: m for m in res.matches}
    assert by_id["fake-0"]["fusedScore"] > by_id.get("fake-9", {"fusedScore": -1})["fusedScore"]


def test_collector_line_separates_sibling_printings(text_index, jitter, rng, monkeypatch):
    """Card 3 and its alt printing tie on features; the collector number decides."""
    sib = _row_for(text_index, "fake-3-alt")
    _use_engine(
        monkeypatch, FakeEngine([(f"{sib['collector_number']}/500 C", 0.97), ("FAK • EN", 0.9)])
    )
    q = jitter(text_index.images[3], rng)
    res = matcher.identify_card(q)
    top_ids = [m["scryfallId"] for m in res.matches[:2]]
    assert set(top_ids) == {"fake-3", "fake-3-alt"}
    assert res.matches[0]["scryfallId"] == "fake-3-alt"
    assert res.matches[0]["collectorMatch"] == {
        "set": "fak",
        "number": sib["collector_number"],
        "lang": "EN",
    }
    assert res.ocr["collector"]["number"] == sib["collector_number"]


def test_garbage_lines_fall_back_to_hash_path(text_index, jitter, rng, monkeypatch):
    _use_engine(monkeypatch, FakeEngine([("7-HU9RA", 0.71), ("21U22B6WG", 0.66)]))
    q = jitter(text_index.images[2], rng)
    res = matcher.identify_card(q)
    assert res.matches[0]["scryfallId"] == "fake-2"
    assert res.ocr["name"] is None and res.ocr["collector"] is None
    assert all(m["shortlistSources"] == ["hash"] for m in res.matches)


def test_orientation_prefers_homography_then_ocr_votes(text_index, jitter, rng, monkeypatch):
    _use_engine(monkeypatch, FakeEngine([("Fake Card fake-1", 0.99)], votes={0: 0.0, 180: 500.0}))
    q = jitter(text_index.images[1], rng)
    res = matcher.identify_card(q)
    # The winner's validated homography says upright, and it outranks the OCR vote.
    assert res.matches[0]["rotation"] == 0
    assert res.orientation == 0


def test_ocr_vote_used_when_no_homography(fake_index, monkeypatch):
    """No metadata table + a blank query: nothing validates, so the OCR vote decides."""
    _use_engine(monkeypatch, FakeEngine([("anything", 0.9)], votes={0: 0.0, 180: 900.0}))
    blank = np.zeros((680, 487, 3), np.uint8)
    res = matcher.identify_card(blank)
    assert all(m["rotation"] is None for m in res.matches)
    assert res.orientation == 180


def test_confidence_rule_reported(text_index, jitter, rng, monkeypatch):
    monkeypatch.setattr(ocr, "get_engine", lambda: None)
    res = matcher.identify_card(jitter(text_index.images[6], rng))
    assert res.matches[0]["confident"] is True
    assert res.matches[0]["confidenceRule"] == "A"
    assert res.timings_ms["total"] > 0 and "stage2" in res.timings_ms


def test_collector_line_promotes_sibling_even_with_fewer_inliers(
    text_index, jitter, rng, monkeypatch
):
    """The measured Mind Stone case: the leader by inliers is a same-art sibling of
    the printing the collector line names; the collector line must pick it."""
    sib = _row_for(text_index, "fake-3-alt")
    _use_engine(
        monkeypatch, FakeEngine([(f"{sib['collector_number']}/500 C", 0.97), ("FAK • EN", 0.9)])
    )
    q = jitter(text_index.images[3], rng)  # image of the ORIGINAL: it wins on inliers
    res = matcher.identify_card(q)
    assert res.matches[0]["scryfallId"] == "fake-3-alt"
    assert res.matches[0]["confidenceRule"] in ("A", "C")  # strong own inliers earn A first
    assert res.matches[1]["scryfallId"] == "fake-3"


def test_band_passes_are_lazy(text_index, jitter, rng, monkeypatch):
    """Bands run only when the full pass produced no collector line."""
    monkeypatch.setattr(config, "OCR_BANDS_LAZY", True)
    with_cn = FakeEngine([("Fake Card fake-1", 0.99), ("001/500 C", 0.97), ("FAK • EN", 0.9)])
    _use_engine(monkeypatch, with_cn)
    matcher.identify_card(jitter(text_index.images[1], rng))
    assert with_cn.band_calls == 0
    without = FakeEngine(
        [("Fake Card fake-1", 0.99)], band_lines=[("001/500 C", 0.97), ("FAK • EN", 0.9)]
    )
    _use_engine(monkeypatch, without)
    res = matcher.identify_card(jitter(text_index.images[1], rng))
    assert without.band_calls == 1
    assert res.ocr["collector"]["number"] == "1"


def test_border_colour_breaks_identical_art_ties(text_index, jitter, rng, monkeypatch):
    """A gold-bordered sibling of a black-bordered crop loses the tie."""
    from app import fusion

    monkeypatch.setattr(ocr, "get_engine", lambda: None)
    # Pretend the alt printing (row 12) is gold-bordered and the original black.
    for row in text_index.rows.values():
        row["border_color"] = "gold" if row["scryfall_id"] == "fake-3-alt" else "black"
    # Force a near-tie: make fusion see the crop as black-bordered (it is: fake cards
    # have a black border) and check the sibling is penalised relative to the original.
    q = jitter(text_index.images[3], rng)
    assert fusion.classify_border(q) == "black"
    res = matcher.identify_card(q)
    by_id = {m["scryfallId"]: m for m in res.matches}
    assert (
        by_id["fake-3"]["fusedScore"] - by_id["fake-3"]["inliers"]
        > by_id["fake-3-alt"]["fusedScore"] - by_id["fake-3-alt"]["inliers"]
    )

"""
Tests for app.fusion: shortlist union, score fusion and the confidence rules.

All inputs are hand-built: row positions are small integers, Hamming distances
are a NumPy array, and Stage-2 results are `Scored` records. No images, no
database, no OCR.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.fusion import (
    FusedScore,
    Scored,
    ShortlistEntry,
    build_shortlist,
    confidence,
    fuse,
)
from app.names import CollectorHit, NameHit, NameTable

# --- helpers ------------------------------------------------------------------


def hit(key: str, score: float, conf: float = 0.9) -> NameHit:
    return NameHit(key=key, score=score, line_conf=conf, line_text=key)


def cn(number: str, base: str | None = None, set_code: str | None = None) -> CollectorHit:
    return CollectorHit(number, base or number, set_code, "EN", None, None, 0.9)


def scored(
    row: int,
    inliers: int,
    hamming: int = 10,
    key: str | None = None,
    faces: list[str] | None = None,
    set_code: str | None = None,
    cn_norm: str | None = None,
    cn_base: str | None = None,
    oracle: str | None = None,
) -> Scored:
    return Scored(
        row=row,
        inliers_valid=inliers,
        hamming=hamming,
        name_key=key,
        face_name_keys=faces if faces is not None else ([key] if key else []),
        set_code=set_code,
        cn_norm=cn_norm,
        cn_base=cn_base or (cn_norm.rstrip("abcdefghijklmnopqrstuvwxyz") if cn_norm else None),
        oracle_id=oracle or (key or f"row{row}"),
    )


def rows_of(ranked: list[FusedScore]) -> list[int]:
    return [fs.entry.row for fs in ranked]


# --- build_shortlist ------------------------------------------------------------


@pytest.fixture
def table() -> NameTable:
    rows = []
    # "forest": 100 printings on rows 0..99; "wurmcoil engine": rows 100..102;
    # "fog": rows 103..104.
    for i in range(100):
        rows.append((i, "forest", ["forest"], "s", str(i), str(i)))
    for i in range(100, 103):
        rows.append((i, "wurmcoil engine", ["wurmcoil engine"], "som", "223", "223"))
    for i in range(103, 105):
        rows.append((i, "fog", ["fog"], "lea", "199", "199"))
    return NameTable.from_rows(rows)


@pytest.fixture
def distances() -> np.ndarray:
    rng = np.random.default_rng(3)
    return rng.integers(5, 40, size=300).astype(np.int64)


def test_shortlist_order_is_cn_then_name_then_hash(table, distances):
    hash_ranked = np.array([200, 201, 202])
    out = build_shortlist(
        hash_ranked, distances, [hit("wurmcoil engine", 95)], table, np.array([104, 103])
    )
    rows = [e.row for e in out]
    # cn rows, then the name rows, then the hash rows; the first two segments
    # are each in ascending Hamming order.
    assert set(rows[:2]) == {103, 104}
    assert set(rows[2:5]) == {100, 101, 102}
    assert rows[5:] == [200, 201, 202]
    for segment in (rows[:2], rows[2:5]):
        assert [distances[r] for r in segment] == sorted(distances[r] for r in segment)
    assert all(e.sources == {"cn"} for e in out[:2])
    assert all(e.sources == {"name"} for e in out[2:5])
    assert all(e.sources == {"hash"} for e in out[5:])


def test_shortlist_merges_sources_for_duplicates(table, distances):
    out = build_shortlist(
        np.array([100, 103, 7]), distances, [hit("wurmcoil engine", 95)], table, np.array([103])
    )
    by_row = {e.row: e.sources for e in out}
    assert by_row[103] == {"cn", "hash"}
    assert by_row[100] == {"name", "hash"}
    assert by_row[7] == {"hash"}
    assert len(out) == len(by_row)  # no duplicate entries
    assert isinstance(out[0], ShortlistEntry)


def test_shortlist_caps_name_rows_by_lowest_hamming(table, distances):
    out = build_shortlist(np.array([]), distances, [hit("forest", 100)], table, None)
    assert len(out) == 40
    chosen = [e.row for e in out]
    best40 = sorted(range(100), key=lambda r: (distances[r], r))[:40]
    assert sorted(chosen) == sorted(best40)
    # In ascending Hamming order.
    assert [distances[r] for r in chosen] == sorted(distances[r] for r in chosen)


def test_shortlist_name_cap_is_per_key(table, distances):
    out = build_shortlist(
        np.array([]),
        distances,
        [hit("forest", 100), hit("wurmcoil engine", 90)],
        table,
        None,
        name_max_rows=10,
    )
    assert len(out) == 13


def test_shortlist_cap_drops_hash_only_rows_from_the_tail_first(table, distances):
    hash_ranked = np.arange(200, 260)  # 60 hash rows
    out = build_shortlist(
        hash_ranked,
        distances,
        [hit("forest", 100)],
        table,
        np.array([103, 104]),
        name_max_rows=40,
        shortlist_max=50,
    )
    assert len(out) == 50
    rows = [e.row for e in out]
    # Every cn and name row survived; only the tail of the hash rows was cut.
    assert {103, 104} <= set(rows)
    assert sum(1 for e in out if "name" in e.sources) == 40
    assert rows[-8:] == list(range(200, 208))


def test_shortlist_cap_truncates_when_no_hash_rows_left_to_drop(table, distances):
    out = build_shortlist(
        np.array([200]),
        distances,
        [hit("forest", 100)],
        table,
        None,
        name_max_rows=40,
        shortlist_max=10,
    )
    assert len(out) == 10
    assert all("name" in e.sources for e in out)


def test_shortlist_unknown_key_and_empty_inputs(table, distances):
    out = build_shortlist(np.array([1, 2]), distances, [hit("no such card", 99)], table, None)
    assert [e.row for e in out] == [1, 2]
    assert build_shortlist(np.array([]), distances, [], table, None) == []
    assert build_shortlist(np.array([]), distances, [], table, np.array([], dtype=np.int64)) == []


# --- fuse ------------------------------------------------------------------------


def test_fuse_strong_stage2_beats_weak_wrong_name():
    entries = [scored(0, 40, key="lightning bolt"), scored(1, 10, key="lightning helix")]
    ranked = fuse(entries, [hit("lightning helix", 82)], None)
    assert rows_of(ranked) == [0, 1]
    assert ranked[1].name_bonus == pytest.approx(0.1)
    assert ranked[0].name_bonus == 0.0


def test_fuse_flat_stage2_strong_name_wins():
    entries = [scored(0, 8, hamming=8, key="lightning bolt"), scored(1, 8, hamming=9, key="shock")]
    ranked = fuse(entries, [hit("shock", 100)], None)
    assert rows_of(ranked) == [1, 0]
    assert ranked[0].name_bonus == 1.0
    assert ranked[0].fused == pytest.approx(8 + 12.0 - 0.05 * 9)


def test_fuse_name_bonus_uses_face_name_keys():
    entries = [
        scored(
            0,
            5,
            key="diaochan artful beauty",
            faces=["diaochan artful beauty", "azula flame of ember island"],
        ),
        scored(1, 5, key="azula something else"),
    ]
    ranked = fuse(entries, [hit("azula flame of ember island", 96)], None)
    assert rows_of(ranked) == [0, 1]
    assert ranked[0].name_bonus == pytest.approx(0.8)


def test_fuse_equal_inlier_reprints_decided_by_collector_line():
    entries = [
        scored(
            0, 12, hamming=10, key="wurmcoil engine", set_code="som", cn_norm="223s", oracle="w"
        ),
        scored(1, 12, hamming=11, key="wurmcoil engine", set_code="som", cn_norm="223", oracle="w"),
        scored(2, 12, hamming=9, key="wurmcoil engine", set_code="c21", cn_norm="223", oracle="w"),
    ]
    ranked = fuse(entries, [], cn("223", set_code="som"))
    assert rows_of(ranked) == [1, 0, 2]
    assert [fs.cn_bonus for fs in ranked] == [1.0, 0.75, 0.0]


def test_fuse_set_less_number_needs_name_support():
    entries = [
        scored(0, 10, hamming=10, key="wurmcoil engine", set_code="som", cn_norm="223"),
        scored(1, 10, hamming=10, key="mind stone", set_code="dmr", cn_norm="223"),
    ]
    # No name hits: a bare number gives nobody a bonus.
    ranked = fuse(entries, [], cn("223"))
    assert [fs.cn_bonus for fs in ranked] == [0.0, 0.0]
    # With a name hit on row 0 the number now corroborates it.
    ranked = fuse(entries, [hit("wurmcoil engine", 90)], cn("223"))
    assert ranked[0].entry.row == 0
    assert ranked[0].cn_bonus == 0.5
    assert ranked[1].cn_bonus == 0.0


def test_fuse_set_code_comparison_is_case_insensitive():
    entries = [scored(0, 10, key="x", set_code="SOM", cn_norm="223")]
    assert fuse(entries, [], cn("223", set_code="som"))[0].cn_bonus == 1.0


def test_fuse_no_ocr_path_matches_legacy_ordering():
    rng = np.random.default_rng(5)
    entries = [
        scored(i, int(rng.integers(0, 30)), hamming=int(rng.integers(6, 18)), key=f"k{i}")
        for i in range(60)
    ]
    ranked = fuse(entries, [], None)
    legacy = sorted(entries, key=lambda e: (-e.inliers_valid, e.hamming))
    assert rows_of(ranked) == [e.row for e in legacy]
    assert all(fs.name_bonus == 0 and fs.cn_bonus == 0 for fs in ranked)


def test_fuse_formula_and_weights():
    e = scored(0, 7, hamming=20, key="x", set_code="s", cn_norm="1")
    fs = fuse([e], [hit("x", 90)], cn("1", set_code="s"), name_w=4, cn_w=3, hash_w=0.1)[0]
    assert fs.name_bonus == pytest.approx(0.5)
    assert fs.cn_bonus == 1.0
    assert fs.fused == pytest.approx(7 + 4 * 0.5 + 3 * 1.0 - 0.1 * 20)


def test_fuse_best_hit_per_key_is_used():
    e = scored(0, 0, hamming=0, key="x")
    fs = fuse([e], [hit("x", 84), hit("x", 96)], None)[0]
    assert fs.name_bonus == pytest.approx(0.8)


def test_fuse_empty():
    assert fuse([], [hit("x", 99)], cn("1", set_code="s")) == []


# --- confidence ----------------------------------------------------------------


def rank(entries: list[Scored], hits=(), cn_hit=None) -> list[FusedScore]:
    return fuse(entries, list(hits), cn_hit)


def test_confidence_empty():
    assert confidence([], [], None) == []


def test_rule_a_image_margin():
    ranked = rank([scored(0, 30, key="a", oracle="A"), scored(1, 10, key="b", oracle="B")])
    assert confidence(ranked, [], None) == [(True, "A"), (False, None)]


def test_rule_a_siblings_do_not_compete():
    ranked = rank(
        [
            scored(0, 30, hamming=8, key="a", oracle="A"),
            scored(1, 28, hamming=9, key="a", oracle="A"),  # another printing
            scored(2, 10, key="b", oracle="B"),
        ]
    )
    assert confidence(ranked, [], None)[0] == (True, "A")


def test_rule_a_fails_on_near_tie_with_different_card():
    ranked = rank([scored(0, 30, key="a", oracle="A"), scored(1, 20, key="b", oracle="B")])
    assert confidence(ranked, [], None)[0] == (False, None)


def test_rule_a_needs_min_inliers():
    ranked = rank([scored(0, 14, key="a", oracle="A")])
    assert confidence(ranked, [], None)[0] == (False, None)
    assert confidence(ranked, [], None, min_inliers=10)[0] == (True, "A")


def test_rule_b_name_anchored():
    ranked = rank([scored(0, 8, key="a", oracle="A"), scored(1, 7, key="b", oracle="B")])
    hits = [hit("a", 95), hit("b", 85)]
    assert confidence(ranked, hits, None)[0] == (True, "B")


def test_rule_b_requires_unambiguous_name():
    ranked = rank([scored(0, 8, key="a", oracle="A"), scored(1, 7, key="b", oracle="B")])
    # Second key within the ambiguity gap → not anchored.
    assert confidence(ranked, [hit("a", 95), hit("b", 92)], None)[0] == (False, None)
    # Score below the confident threshold → not anchored.
    assert confidence(ranked, [hit("a", 91)], None)[0] == (False, None)


def test_rule_b_requires_some_inliers():
    ranked = rank([scored(0, 5, key="a", oracle="A")], hits=[hit("a", 100)])
    assert confidence(ranked, [hit("a", 100)], None)[0] == (False, None)
    assert confidence(ranked, [hit("a", 100)], None, min_inliers_with_name=5)[0] == (True, "B")


def test_rule_b_matches_face_name_keys():
    ranked = rank([scored(0, 8, key="diaochan", faces=["diaochan", "azula"], oracle="A")])
    assert confidence(ranked, [hit("azula", 97)], None)[0] == (True, "B")


def test_rule_c_collector_anchored():
    entries = [
        scored(0, 7, key="a", set_code="som", cn_norm="223", oracle="A"),
        scored(1, 7, key="b", set_code="som", cn_norm="224", oracle="B"),
    ]
    c = cn("223", set_code="som")
    ranked = rank(entries, cn_hit=c)
    assert ranked[0].entry.row == 0
    assert confidence(ranked, [], c)[0] == (True, "C")


def test_rule_c_requires_exact_number_and_inliers():
    c = cn("223", set_code="som")
    family = rank([scored(0, 7, key="a", set_code="som", cn_norm="223s", oracle="A")], cn_hit=c)
    assert confidence(family, [], c)[0] == (False, None)  # base-only match is not enough
    few = rank([scored(0, 5, key="a", set_code="som", cn_norm="223", oracle="A")], cn_hit=c)
    assert confidence(few, [], c)[0] == (False, None)
    no_set = rank([scored(0, 7, key="a", set_code="som", cn_norm="223", oracle="A")])
    assert confidence(no_set, [], cn("223"))[0] == (False, None)


def test_rule_precedence_a_before_b_before_c():
    c = cn("223", set_code="som")
    entries = [scored(0, 30, key="a", set_code="som", cn_norm="223", oracle="A")]
    ranked = rank(entries, hits=[hit("a", 100)], cn_hit=c)
    assert confidence(ranked, [hit("a", 100)], c)[0] == (True, "A")
    entries = [scored(0, 8, key="a", set_code="som", cn_norm="223", oracle="A")]
    ranked = rank(entries, hits=[hit("a", 100)], cn_hit=c)
    assert confidence(ranked, [hit("a", 100)], c)[0] == (True, "B")


def test_veto_strong_name_disagreeing_with_leader():
    c = cn("223", set_code="som")
    entries = [
        scored(0, 20, key="a", set_code="som", cn_norm="223", oracle="A"),
        scored(1, 12, key="b", oracle="B"),
    ]
    ranked = rank(entries, hits=[hit("b", 96)], cn_hit=c)
    assert ranked[0].entry.row == 0  # rule C would have made the leader confident
    assert confidence(ranked, [hit("b", 96)], c)[0] == (False, None)


def test_veto_not_applied_when_leader_clearly_beats_the_named_row():
    c = cn("223", set_code="som")
    # 14 inliers: below rule A's floor so the decision rests on rule C.
    entries = [
        scored(0, 14, key="a", set_code="som", cn_norm="223", oracle="A"),
        scored(1, 5, key="b", oracle="B"),
    ]
    ranked = rank(entries, hits=[hit("b", 96)], cn_hit=c)
    assert confidence(ranked, [hit("b", 96)], c)[0] == (True, "C")


def test_veto_ignores_names_below_veto_score_and_names_the_leader_carries():
    c = cn("223", set_code="som")
    entries = [
        scored(0, 20, key="a", set_code="som", cn_norm="223", oracle="A"),
        scored(1, 12, key="b", oracle="B"),
    ]
    ranked = rank(entries, hits=[hit("b", 94)], cn_hit=c)
    assert confidence(ranked, [hit("b", 94)], c)[0] == (True, "C")
    ranked = rank(entries, hits=[hit("a", 99)], cn_hit=c)
    assert confidence(ranked, [hit("a", 99)], c)[0] == (True, "B")


def test_veto_without_a_row_carrying_the_key_does_nothing():
    ranked = rank([scored(0, 30, key="a", oracle="A"), scored(1, 5, key="b", oracle="B")])
    assert confidence(ranked, [hit("zzz", 99)], None)[0] == (True, "A")


def test_lower_ranks_use_min_inliers_only():
    ranked = rank(
        [
            scored(0, 40, key="a", oracle="A"),
            scored(1, 16, key="b", oracle="B"),
            scored(2, 14, key="c", oracle="C"),
        ]
    )
    assert confidence(ranked, [], None) == [(True, "A"), (True, None), (False, None)]


# --- border colour + collector promotion -------------------------------------


def _fs(row, inliers, oracle, cn_bonus=0.0, hamming=5, border=None):
    from app.fusion import FusedScore, Scored

    entry = Scored(
        row=row, inliers_valid=inliers, hamming=hamming, oracle_id=oracle, border_color=border
    )
    return FusedScore(entry, float(inliers) + 10 * cn_bonus, 0.0, cn_bonus)


def test_promote_collector_match_moves_sibling_to_front():
    from app.fusion import promote_collector_match
    from app.names import CollectorHit

    hit = CollectorHit("232", "232", "dmr", "EN", "C", "261", 0.97)
    ranked = [_fs(1, 142, "o1"), _fs(2, 130, "o1", cn_bonus=1.0), _fs(3, 120, "o2")]
    out = promote_collector_match(ranked, hit, min_inliers=6)
    assert [r.entry.row for r in out] == [2, 1, 3]


def test_promote_collector_match_ignores_other_cards_and_weak_rows():
    from app.fusion import promote_collector_match
    from app.names import CollectorHit

    hit = CollectorHit("232", "232", "dmr", "EN", "C", "261", 0.97)
    other_card = [_fs(1, 142, "o1"), _fs(2, 130, "o2", cn_bonus=1.0)]
    assert [r.entry.row for r in promote_collector_match(other_card, hit)] == [1, 2]
    weak = [_fs(1, 142, "o1"), _fs(2, 3, "o1", cn_bonus=1.0)]
    assert [r.entry.row for r in promote_collector_match(weak, hit, min_inliers=6)] == [1, 2]
    assert promote_collector_match([], hit) == []
    assert [r.entry.row for r in promote_collector_match(other_card, None)] == [1, 2]


def test_border_bonus_is_asymmetric_and_skips_unknowns():
    from app.fusion import Scored, fuse

    rows = [
        Scored(row=0, inliers_valid=50, hamming=5, border_color="gold"),
        Scored(row=1, inliers_valid=47, hamming=5, border_color="black"),
        Scored(row=2, inliers_valid=47, hamming=5, border_color="borderless"),
    ]
    ranked = fuse(rows, [], None, crop_border="black", border_w=8.0)
    by_row = {r.entry.row: r.fused for r in ranked}
    assert by_row[1] > by_row[0]  # 47 + 2 > 50 - 8
    assert by_row[2] == 47 - 0.05 * 5  # borderless: untouched
    unknown = fuse(rows, [], None, crop_border=None, border_w=8.0)
    assert [r.entry.row for r in unknown] == [0, 1, 2]


def test_classify_border_on_synthetic_rings():
    import numpy as np

    from app.fusion import classify_border

    def card(bgr):
        img = np.full((680, 487, 3), 128, np.uint8)
        img[:, :] = (200, 200, 200)
        t = 12
        img[:t] = bgr
        img[-t:] = bgr
        img[:, :t] = bgr
        img[:, -t:] = bgr
        return img

    assert classify_border(card((15, 15, 15))) == "black"
    assert classify_border(card((240, 240, 240))) == "white"
    assert classify_border(card((40, 170, 210))) == "gold"  # BGR: warm yellow-orange
    assert classify_border(card((150, 150, 150))) == "silver"
    assert classify_border(card((200, 30, 30))) is None  # saturated blue: not a border colour


def test_promote_number_only_hit_when_unique_among_siblings():
    from app.fusion import promote_collector_match
    from app.names import CollectorHit

    hit = CollectorHit("79", "79", None, None, None, "143", 0.95)  # set-less read
    ranked = [_fs(1, 98, "o1"), _fs(2, 60, "o1", cn_bonus=0.5), _fs(3, 40, "o2", cn_bonus=0.5)]
    assert [r.entry.row for r in promote_collector_match(ranked, hit)] == [2, 1, 3]
    # Two siblings carry the number: ambiguous, leave the image ranking alone.
    ranked2 = [_fs(1, 98, "o1"), _fs(2, 60, "o1", cn_bonus=0.5), _fs(3, 55, "o1", cn_bonus=0.5)]
    assert [r.entry.row for r in promote_collector_match(ranked2, hit)] == [1, 2, 3]


def test_promotion_skipped_when_leader_is_consistent_with_the_read():
    """A prerelease promo (pmh2 137s) prints 'MH2 137'; the read cannot separate it
    from mh2 137, so the image leader stays."""
    from app.fusion import FusedScore, Scored, promote_collector_match
    from app.names import CollectorHit

    hit = CollectorHit("137", "137", "mh2", "EN", "R", None, 0.95)
    promo = Scored(
        row=1,
        inliers_valid=56,
        hamming=4,
        set_code="pmh2",
        cn_norm="137s",
        cn_base="137",
        oracle_id="o",
    )
    regular = Scored(
        row=2,
        inliers_valid=50,
        hamming=6,
        set_code="mh2",
        cn_norm="137",
        cn_base="137",
        oracle_id="o",
    )
    ranked = [FusedScore(promo, 56.0, 0.0, 0.0), FusedScore(regular, 60.0, 0.0, 1.0)]
    assert [r.entry.row for r in promote_collector_match(ranked, hit)] == [1, 2]


def test_list_form_counts_as_exact_collector_match():
    from app.fusion import Scored, fuse
    from app.names import CollectorHit

    hit = CollectorHit("160", "160", "cmr", "EN", "U", None, 0.95)
    lst = Scored(
        row=1,
        inliers_valid=10,
        hamming=5,
        set_code="plst",
        cn_norm="cmr-160",
        cn_base="cmr-160",
        oracle_id="o",
    )
    ranked = fuse([lst], [], hit)
    assert ranked[0].cn_bonus == 1.0

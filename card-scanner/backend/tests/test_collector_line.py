"""
Tests for the collector-line parser and lookup ladder in app.names.

Lines are the kind of strings RapidOCR returns for the bottom 9 % of a card
crop: the number/rarity box, the set/language box (often merged with the
artist credit), the copyright line, and the occasional power/toughness box
that must *not* be mistaken for a collector number.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.names import (
    CollectorHit,
    NameTable,
    lookup_collector,
    parse_collector_line,
    set_code_variants,
)

SETS = frozenset({"tla", "tle", "dmr", "sta", "som", "m20", "dmu", "znc", "mir", "ice", "akh"})


def parse(*lines: str, conf: float = 0.9, sets: frozenset[str] = SETS) -> CollectorHit | None:
    return parse_collector_line([(line, conf) for line in lines], sets)


# --- Number lines -------------------------------------------------------------


@pytest.mark.parametrize(
    ("line", "number", "base", "rarity", "total"),
    [
        ("0150 R", "150", "150", "R", None),
        ("150/274 R", "150", "150", "R", "274"),
        ("184/261C", "184", "184", "C", "261"),
        ("078 R", "78", "78", "R", None),
        ("M 0117", "117", "117", "M", None),
        ("U 0281", "281", "281", "U", None),
        ("R 0304", "304", "304", "R", None),
        ("U0258", "258", "258", "U", None),
        ("*223/249", "223", "223", None, "249"),  # promo star
        ("★223/249", "223", "223", None, "249"),
        ("0150s R", "150s", "150", "R", None),  # prerelease suffix
        ("224p/274 R", "224p", "224", "R", "274"),
        ("m 0117", "117", "117", "M", None),  # case-insensitive
        ("  0150   R  ", "150", "150", "R", None),  # whitespace collapsed
    ],
)
def test_number_lines(line, number, base, rarity, total):
    hit = parse(line)
    assert hit is not None, line
    assert (hit.number, hit.base, hit.rarity, hit.total) == (number, base, rarity, total)
    assert hit.set_code is None and hit.lang is None
    assert hit.confidence == pytest.approx(0.9)


def test_copyright_line_number():
    hit = parse("&2023 Wizards of the Coast 280")
    assert hit is not None
    assert (hit.number, hit.rarity, hit.total) == ("280", None, None)

    hit = parse("™ & © 2007 Wizards of the Coast, Inc. 280/383")
    assert hit is not None
    assert (hit.number, hit.total) == ("280", "383")


def test_copyright_line_year_is_not_a_number():
    assert parse("©2021 Wizards") is None
    assert parse("™ & © 1995 Wizards of the Coast") is None
    assert parse("™ & © 1993-1995 Wizards of the Coast, Inc.") is None
    assert parse("© 2021 Wizards of the Coast 2021") is None


# --- Negatives ------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    ["2/2", "6/6", "1/1", "1995", "432", "078", "Flying", "R", "TLA • EN", "", "   "],
)
def test_lines_that_are_not_a_hit_alone(line):
    assert parse(line) is None


def test_power_toughness_with_set_line_is_still_not_a_number():
    # A P/T box never becomes a collector number, even with a set line present.
    assert parse("6/6", "TLA • EN") is None


def test_unknown_set_code_does_not_qualify_a_bare_number():
    assert parse("432", "XYZ • EN") is None
    assert parse("432", "IF AN") is None  # rules text shaped like SET LANG


def test_negative_confidence_lines_are_ignored():
    assert parse_collector_line([("0150 R", -1.0)], SETS) is None


# --- Set lines and multi-line combination --------------------------------------


@pytest.mark.parametrize(
    ("set_line", "set_code", "lang"),
    [
        ("TLA • EN", "tla", "EN"),
        ("DMR·EN ADAM REX", "dmr", "EN"),
        ("STA.JP", "sta", "JP"),
        ("TLE •EN B3: FIRE", "tle", "EN"),
        ("SOM - EN", "som", "EN"),
        ("DMU EN", "dmu", "EN"),
        ("tla • en", "tla", "EN"),
    ],
)
def test_set_lines_combine_with_a_number_line(set_line, set_code, lang):
    hit = parse("0150 R", set_line)
    assert hit is not None
    assert hit.number == "150"
    assert hit.set_code == set_code
    assert hit.lang == lang


def test_set_line_qualifies_a_bare_number():
    hit = parse("432", "TLA • EN")
    assert hit is not None
    assert (hit.number, hit.set_code, hit.lang, hit.rarity) == ("432", "tla", "EN", None)


def test_merged_number_and_set_line():
    hit = parse("0150 R TLA • EN")
    assert hit is not None
    assert (hit.number, hit.rarity, hit.set_code, hit.lang) == ("150", "R", "tla", "EN")


def test_order_of_lines_does_not_matter():
    a = parse("STA • JP", "120 U")
    b = parse("120 U", "STA • JP")
    assert a == b
    assert a is not None and (a.number, a.set_code, a.lang) == ("120", "sta", "JP")


def test_confidence_is_mean_of_lines_used():
    hit = parse_collector_line([("0150 R", 0.8), ("TLA • EN", 0.6), ("Some artist", 0.99)], SETS)
    assert hit is not None
    assert hit.confidence == pytest.approx(0.7)


def test_qualified_number_beats_bare_number():
    hit = parse("1995", "0150 R")
    assert hit is not None and hit.number == "150"


def test_higher_confidence_wins_among_qualified_numbers():
    hit = parse_collector_line([("0150 R", 0.6), ("0151 R", 0.9)], SETS)
    assert hit is not None and hit.number == "151"


def test_highest_confidence_set_line_wins():
    hit = parse_collector_line([("0150 R", 0.9), ("TLA • EN", 0.5), ("TLE • EN", 0.8)], SETS)
    assert hit is not None and hit.set_code == "tle"


# --- Set-code confusion variants -------------------------------------------------


@pytest.mark.parametrize(
    ("read", "expected"),
    [
        ("S0M", "som"),  # 0 read for O
        ("5TA", "sta"),  # 5 for S
        ("M2O", "m20"),  # O for 0
        ("2NC", "znc"),  # 2 for Z
        ("1CE", "ice"),  # 1 for I
        ("M1R", "mir"),
        ("50M", "som"),  # two confusions
    ],
)
def test_set_code_confusion_variants_are_repaired(read, expected):
    hit = parse("0150 R", f"{read} • EN")
    assert hit is not None
    assert hit.set_code == expected


def test_known_code_is_preferred_over_its_variants():
    # "SOM" is a real code; a hypothetical "S0M" index code must not steal it.
    hit = parse("0150 R", "SOM • EN", sets=SETS | {"s0m"})
    assert hit is not None and hit.set_code == "som"


def test_set_code_variants_order_and_cap():
    variants = set_code_variants("S0M")
    assert variants[0] == "s0m"
    assert variants.index("som") < variants.index("5om")  # singles before doubles
    assert len(set_code_variants("OSIB0Z")) <= 9  # token + at most 8 variants
    assert len(set(set_code_variants("OSIB0Z"))) == len(set_code_variants("OSIB0Z"))
    assert set_code_variants("TLA") == ["tla"]


# --- lookup_collector ladder -----------------------------------------------------

ROWS = [
    # (row_index, name_key, face_name_keys, set_code, cn_norm, cn_base)
    (0, "wurmcoil engine", ["wurmcoil engine"], "som", "223", "223"),
    (1, "wurmcoil engine", ["wurmcoil engine"], "som", "223s", "223"),
    (2, "ran and shaw", ["ran and shaw"], "tla", "150", "150"),
    (3, "ran and shaw", ["ran and shaw"], "tla", "150s", "150"),
    (4, "snakeskin veil", ["snakeskin veil"], "sta", "120", "120"),
    (5, "mind stone", ["mind stone"], "dmr", "120", "120"),
    (6, "mind stone", ["mind stone"], "znc", "114", "114"),
]


@pytest.fixture(scope="module")
def table() -> NameTable:
    return NameTable.from_rows(ROWS)


def hit(number: str, base: str, set_code: str | None = None) -> CollectorHit:
    return CollectorHit(number, base, set_code, "EN", None, None, 0.9)


def test_ladder_exact_set_and_number(table):
    assert lookup_collector(hit("223", "223", "som"), table).tolist() == [0]
    assert lookup_collector(hit("223s", "223", "som"), table).tolist() == [1]


def test_ladder_falls_back_to_set_and_base_family(table):
    # "223p" is not indexed; the family sharing the printed number is.
    assert lookup_collector(hit("223p", "223", "som"), table).tolist() == [0, 1]


def test_ladder_no_set_requires_name_rows(table):
    assert lookup_collector(hit("120", "120"), table).size == 0
    assert lookup_collector(hit("120", "120"), table, np.array([], dtype=np.int64)).size == 0


def test_ladder_no_set_intersects_number_with_name_rows(table):
    # "120" exists in STA and DMR; the name pass points at Snakeskin Veil.
    rows = lookup_collector(hit("120", "120"), table, np.array([4, 2]))
    assert rows.tolist() == [4]


def test_ladder_no_set_intersects_base_with_name_rows(table):
    # "120s" is not indexed anywhere; the base "120" ∩ Mind Stone rows → DMR.
    rows = lookup_collector(hit("120s", "120"), table, np.array([5, 6]))
    assert rows.tolist() == [5]


def test_ladder_set_miss_falls_through_to_name_anchored_rungs(table):
    # The set was read (validated) but this number does not exist in it; the
    # number still agrees with the name-matched card, which is safe to use.
    rows = lookup_collector(hit("120", "120", "tla"), table, np.array([4]))
    assert rows.tolist() == [4]


def test_ladder_empty_when_nothing_matches(table):
    assert lookup_collector(hit("999", "999", "som"), table, np.array([0, 1])).size == 0
    assert lookup_collector(hit("120", "120"), table, np.array([0, 1])).size == 0


def test_ladder_returns_int64_arrays(table):
    rows = lookup_collector(hit("223", "223", "som"), table)
    assert rows.dtype == np.int64

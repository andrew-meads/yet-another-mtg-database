"""
Tests for app.names: key normalisation, the NameTable and fuzzy name matching.

Everything here is pure Python + NumPy + rapidfuzz — no Postgres, no OCR, no
images. The matching tests use a ~300-key synthetic table (a few dozen real
card names plus deterministic filler) and feed it OCR-style corruptions.
"""

from __future__ import annotations

import random
import time

import numpy as np
import pytest

from app import names
from app.names import (
    NameHit,
    NameTable,
    is_latin_name,
    match_names,
    name_keys_for,
    normalize_collector_number,
    normalize_key,
)

# --- normalize_key ------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "key"),
    [
        ("Æther Vial", "aether vial"),
        ("Lim-Dûl", "lim dul"),
        ("Lim-Dûl's Vault", "lim duls vault"),
        ("Freyalise's Charm", "freyalises charm"),
        ("Freyalise’s Charm", "freyalises charm"),  # curly apostrophe
        ("Armed // Dangerous", "armed dangerous"),
        ("  FIRE   //  Ice  ", "fire ice"),
        ("B.F.M. (Big Furry Monster)", "b f m big furry monster"),
        ("Jötun Grunt", "jotun grunt"),
        ("Weiß", "weiss"),
        ("Séance", "seance"),
        ("Ajani, Caller of the Pride", "ajani caller of the pride"),
        ("Wurmcoil Engine", "wurmcoil engine"),
        ("", ""),
        ("   ", ""),
        ("---", ""),
        ("対抗呪文", ""),
    ],
)
def test_normalize_key(raw, key):
    assert normalize_key(raw) == key


def test_normalize_key_is_idempotent():
    for raw in ("Æther Vial", "Lim-Dûl's Vault", "Armed // Dangerous"):
        once = normalize_key(raw)
        assert normalize_key(once) == once


# --- is_latin_name ------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Counterspell", True),
        ("Azula, Flame of Ember Island", True),
        ("Lim-Dûl's Vault", True),
        ("1996 World Champion", True),
        ("B.F.M. (Big Furry Monster)", True),
        ("対抗呪文", False),
        ("対抗呪文 X", False),
        ("Gegenzauber", True),  # German printed name is still Latin script
        ("", False),
        (None, False),
        ("   ", False),
        ("1234", False),
    ],
)
def test_is_latin_name(raw, expected):
    assert is_latin_name(raw) is expected


# --- name_keys_for ------------------------------------------------------------


def test_name_keys_for_split_card_full_name_first_and_deduped():
    keys = name_keys_for("Armed // Dangerous", face_names=["Armed", "Dangerous"])
    assert keys == ["armed dangerous", "armed", "dangerous"]


def test_name_keys_for_flavor_name_included_when_latin():
    keys = name_keys_for("Diaochan, Artful Beauty", flavor_name="Azula, Flame of Ember Island")
    assert keys == ["diaochan artful beauty", "azula flame of ember island"]


def test_name_keys_for_non_latin_printed_name_excluded():
    assert name_keys_for("Counterspell", printed_name="対抗呪文") == ["counterspell"]


def test_name_keys_for_latin_printed_name_included():
    assert name_keys_for("Wall of Roots", printed_name="Wurzelmauer") == [
        "wall of roots",
        "wurzelmauer",
    ]


def test_name_keys_for_drops_empty_and_duplicate_keys():
    keys = name_keys_for("Fog", face_names=["", "Fog", "  "], printed_name="Fog")
    assert keys == ["fog"]


def test_name_keys_for_empty_name():
    assert name_keys_for("") == []


# --- normalize_collector_number -----------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("0117", ("117", "117")),
        ("117", ("117", "117")),
        ("223★", ("223", "223")),
        ("1486★", ("1486", "1486")),
        ("100†", ("100", "100")),
        ("150s", ("150s", "150")),
        ("224S", ("224s", "224")),
        ("57a", ("57a", "57")),
        ("271p", ("271p", "271")),
        ("A-219", ("a-219", "a-219")),
        ("AKH-213", ("akh-213", "akh-213")),
        (" 12 ", ("12", "12")),
        ("0", ("0", "0")),
        ("000", ("0", "0")),
        ("0078 R", ("78r", "78")),  # whitespace removed, letters kept then stripped for base
        ("", ("", "")),
        (None, ("", "")),
    ],
)
def test_normalize_collector_number(raw, expected):
    assert normalize_collector_number(raw) == expected


# --- NameTable ----------------------------------------------------------------

ROWS = [
    # (row_index, name_key, face_name_keys, set_code, cn_norm, cn_base)
    (0, "wurmcoil engine", ["wurmcoil engine"], "SOM", "223", "223"),
    (1, "wurmcoil engine", ["wurmcoil engine"], "som", "223s", "223"),
    (2, "armed dangerous", ["armed dangerous", "armed", "dangerous"], "dgm", "122", "122"),
    (3, "fog", None, "lea", "199", "199"),
    (4, None, [], None, None, None),  # pre-backfill row: contributes nothing
    (5, "fog", ["fog", ""], "m10", "0", "0"),
]


def test_name_table_from_rows_maps():
    table = NameTable.from_rows(ROWS)

    assert table.keys == sorted({"wurmcoil engine", "armed dangerous", "armed", "dangerous", "fog"})
    assert table.key_lengths.tolist() == [len(k) for k in table.keys]

    assert table.rows_by_key["wurmcoil engine"].tolist() == [0, 1]
    assert table.rows_by_key["armed"].tolist() == [2]
    assert table.rows_by_key["fog"].tolist() == [3, 5]
    assert "" not in table.rows_by_key

    # Set codes are lower-cased on the way in.
    assert table.set_codes == frozenset({"som", "dgm", "lea", "m10"})
    assert table.rows_by_set_cn[("som", "223")].tolist() == [0]
    assert table.rows_by_set_cn[("som", "223s")].tolist() == [1]
    assert table.rows_by_set_base[("som", "223")].tolist() == [0, 1]
    assert table.rows_by_cn["223"].tolist() == [0]
    assert table.rows_by_cn_base["223"].tolist() == [0, 1]
    assert ("som", "") not in table.rows_by_set_cn

    for arr in table.rows_by_key.values():
        assert arr.dtype == np.int64


def test_name_table_empty():
    table = NameTable.from_rows([])
    assert table.keys == []
    assert match_names([("Fog", 0.9)], table) == []


# --- match_names on a synthetic table ------------------------------------------

REAL_NAMES = [
    "Llanowar Elves",
    "Wurmcoil Engine",
    "Lightning Bolt",
    "Flametongue Kavu",
    "Freyalise's Charm",
    "Serra Angel",
    "Serra Avenger",
    "Serra Ascendant",
    "Fog",
    "Opt",
    "Shock",
    "Fireball",
    "Counterspell",
    "Dark Ritual",
    "Giant Growth",
    "Mind Stone",
    "Dragon Whelp",
    "Snakeskin Veil",
    "Ran and Shaw",
    "Wall of Roots",
    "Swift Savior",
    "Diaochan, Artful Beauty",
    "Azula, Flame of Ember Island",
    "Æther Vial",
    "Lim-Dûl's Vault",
    "Armed // Dangerous",
    "Armed",
    "Dangerous",
    "Bonecrusher Giant",
    "Stomp",
    "Delver of Secrets",
    "Insectile Aberration",
    "Thoughtseize",
    "Brainstorm",
    "Ponder",
    "Preordain",
    "Island",
    "Forest",
    "Swamp",
    "Mountain",
    "Plains",
]

_SYLLABLES = [
    "ka", "vu", "ra", "lo", "mi", "ne", "tor", "gal", "el", "ith", "or", "an",
    "dra", "gon", "fla", "me", "sha", "dow", "ven", "ger", "mor", "tal", "sil",
    "ver", "bla", "de", "thun", "der", "sto", "rm", "wa", "ter", "ea", "rth",
]  # fmt: skip


def _fake_names(n: int, seed: int) -> list[str]:
    """Deterministic pronounceable filler names, 1–3 words of 1–3 syllables."""
    rng = random.Random(seed)

    def word() -> str:
        return "".join(rng.choice(_SYLLABLES) for _ in range(rng.randint(1, 3)))

    out: set[str] = set()
    while len(out) < n:
        out.add(" ".join(word() for _ in range(rng.randint(1, 3))))
    return sorted(out)


def _table_from_names(all_names: list[str]) -> NameTable:
    rows = []
    for i, raw in enumerate(all_names):
        keys = name_keys_for(raw)
        rows.append((i, keys[0], keys, "tst", str(i), str(i)))
    return NameTable.from_rows(rows)


@pytest.fixture(scope="module")
def table() -> NameTable:
    """~300 keys: the real names above plus deterministic filler."""
    return _table_from_names(REAL_NAMES + _fake_names(260, seed=7))


def _top_key(table: NameTable, line: str, conf: float = 0.9, **kw) -> str | None:
    hits = match_names([(line, conf)], table, **kw)
    return hits[0].key if hits else None


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("Llanowar Elves", "llanowar elves"),  # clean read
        ("Llanowar Elvs", "llanowar elves"),  # dropped character
        ("Wurmc0il Engine", "wurmcoil engine"),  # 0 for o
        ("Lightning Bo1t", "lightning bolt"),  # 1 for l
        ("Flarnetongue Kavu", "flametongue kavu"),  # rn for m
        ("Freyalises Charm", "freyalises charm"),  # missing apostrophe → exact
        ("FREYALISE'S CHARM", "freyalises charm"),  # case
        ("Aether Vial", "aether vial"),  # ligature folded on the index side
        ("Lim-Dul's Vault", "lim duls vault"),  # accent folded on the index side
        ("Azula, Flame of Ember Island", "azula flame of ember island"),
        ("Dangerous", "dangerous"),  # split-card half read on its own
    ],
)
def test_match_names_ocr_corruptions_top1(table, line, expected):
    assert _top_key(table, line) == expected


def test_match_names_returns_namehit_fields(table):
    hits = match_names([("Wurmc0il Engine", 0.8)], table)
    top = hits[0]
    assert isinstance(top, NameHit)
    assert top.key == "wurmcoil engine"
    assert 80 <= top.score < 100
    assert top.line_conf == 0.8
    assert top.line_text == "Wurmc0il Engine"
    assert top.partial is False


def test_short_name_guard_requires_exact_match(table):
    # One-edit neighbours of three-letter names are rules-text words, not names.
    assert _top_key(table, "fo") is None
    assert _top_key(table, "for") is None
    assert _top_key(table, "apt") is None
    assert _top_key(table, "opt") == "opt"
    assert _top_key(table, "Fog") == "fog"


def test_mid_length_guard_needs_higher_score(table):
    # "shack" vs "shock": ratio 80 clears min_score but not mid_score (90).
    assert _top_key(table, "shack") is None
    assert _top_key(table, "shock") == "shock"
    # Longer keys use the plain floor: one edit in "fireball" is fine.
    assert _top_key(table, "firebal") == "fireball"


def test_rules_text_lines_do_not_match_short_names(table):
    lines = [
        ("Flying", 0.95),
        ("Target creature gets +3/+3 until end of turn.", 0.9),
        ("Prevent all combat damage that would be dealt this turn.", 0.9),
        ("Sacrifice a creature: Add {R}.", 0.85),
        ("When this creature enters, draw a card.", 0.9),
        ("Enchant creature", 0.9),
        ("2/2", 0.7),
    ]
    hits = match_names(lines, table)
    assert {h.key for h in hits}.isdisjoint({"fog", "opt", "shock"})


def test_ambiguity_gap_keeps_both_near_ties(table):
    # "serra anger" is ~91 against both "serra angel" and "serra avenger".
    hits = match_names([("Serra Anger", 1.0)], table, top_m=1)
    keys = [h.key for h in hits]
    assert set(keys[:2]) == {"serra angel", "serra avenger"}
    assert "serra ascendant" not in keys
    # With the gap disabled only top_m survives.
    hits = match_names([("Serra Anger", 1.0)], table, top_m=1, ambiguity_gap=0)
    assert len(hits) == 1


def test_top_m_limits_distinct_keys(table):
    # Distinct confidences: an exact tie in ranking value counts as a near-tie.
    lines = [
        ("Llanowar Elves", 0.95),
        ("Lightning Bolt", 0.9),
        ("Counterspell", 0.85),
        ("Dark Ritual", 0.8),
        ("Brainstorm", 0.75),
    ]
    hits = match_names(lines, table, top_m=3, ambiguity_gap=0)
    assert [h.key for h in hits] == ["llanowar elves", "lightning bolt", "counterspell"]


def test_ranking_weights_score_by_line_confidence(table):
    lines = [("Lightning Bolt", 0.4), ("Counterspell", 0.95)]
    hits = match_names(lines, table)
    assert [h.key for h in hits[:2]] == ["counterspell", "lightning bolt"]


def test_best_line_per_key(table):
    # Two reads of the same name: the hit reports the better one.
    lines = [("Lightnng Bolt", 0.9), ("Lightning Bolt", 0.7), ("Lightning Bolt", 0.95)]
    hits = match_names(lines, table)
    assert hits[0].key == "lightning bolt"
    assert hits[0].line_conf == 0.95
    assert hits[0].score == 100
    assert sum(h.key == "lightning bolt" for h in hits) == 1


def test_partial_pass_catches_swallowed_name_box(table):
    # The name box merged with the mana cost and the type line: the full ratio
    # is ~60, far below the floor, but the name is contained verbatim.
    hits = match_names([("Wurmcoil Engine 6 Artifact Creature", 0.9)], table)
    assert hits and hits[0].key == "wurmcoil engine"
    assert hits[0].partial is True
    assert hits[0].score >= 92
    # Disabling the partial pass (impossible length) loses the hit.
    assert (
        match_names([("Wurmcoil Engine 6 Artifact Creature", 0.9)], table, partial_min_len=99) == []
    )


def test_partial_pass_never_matches_a_truncated_read(table):
    # A line *shorter* than the key must not be rescued by substring matching,
    # otherwise "fire" would hit every name containing it.
    assert match_names([("Wurmcoil", 0.9)], table) == []
    assert match_names([("Lightning", 0.9)], table) == []


def test_partial_pass_only_for_long_keys(table):
    # "fog" inside a rules line must not become a hit through partial_ratio.
    hits = match_names([("Fog effects until end of turn", 0.9)], table)
    assert "fog" not in {h.key for h in hits}


def test_lines_with_negative_confidence_or_empty_text_are_ignored(table):
    assert match_names([("Lightning Bolt", -1.0)], table) == []
    assert match_names([("", 0.9), ("   ", 0.9), ("---", 0.9)], table) == []
    assert match_names([], table) == []


def test_min_score_parameter_is_honoured(table):
    assert _top_key(table, "Llanowar Elvs") == "llanowar elves"
    assert _top_key(table, "Llanowar Elvs", min_score=99) is None


def test_match_names_speed_on_index_sized_table():
    """12 OCR lines against ~36k keys must stay well inside the OCR budget."""
    big = _table_from_names(REAL_NAMES + _fake_names(36_000, seed=11))
    assert len(big.keys) >= 36_000
    lines = [
        ("Wurmcoil Engine", 0.95),
        ("Artifact Creature — Wurm", 0.9),
        ("Deathtouch, lifelink", 0.9),
        ("When Wurmcoil Engine dies, create a 3/3 colorless", 0.85),
        ("Phyrexian Wurm artifact creature token with deathtouch", 0.85),
        ("and a 3/3 colorless Phyrexian Wurm artifact creature", 0.85),
        ("token with lifelink.", 0.8),
        ("6/6", 0.7),
        ("223/249 M", 0.8),
        ("SOM • EN", 0.8),
        ("™ & © 2010 Wizards of the Coast LLC", 0.7),
        ("Raymond Swanland", 0.75),
    ]
    match_names(lines, big)  # warm the thread pool once
    best = min(_timed(lambda: match_names(lines, big)) for _ in range(3))
    assert best < 0.150, f"match_names took {best * 1000:.0f} ms"
    assert match_names(lines, big)[0].key == "wurmcoil engine"


def _timed(fn) -> float:
    t0 = time.perf_counter()
    fn()
    return time.perf_counter() - t0


# --- module sanity ------------------------------------------------------------


def test_module_does_not_import_config():
    """Tunables are keyword parameters; the matcher passes config values in."""
    assert not hasattr(names, "config")


# --- legal-line filter and partial coverage ------------------------------------


def _table_with(keys):
    from app.names import NameTable

    return NameTable.from_rows((i, k, [k], "set", str(i), str(i)) for i, k in enumerate(keys))


def test_legal_lines_never_match_names():
    from app.names import match_names

    table = _table_with(["of the coast", "wall of roots", "mind stone"])
    lines = [
        ("1996 Wizards of the Coast, Inc Alle Rechte vorbehalten.", 0.9),
        ("™ & © 2023 Wizards of the Coast", 0.9),
    ]
    assert match_names(lines, table) == []


def test_partial_pass_requires_coverage_of_the_line():
    from app.names import match_names

    table = _table_with(["wurmcoil engine", "some other card name"])
    # A title box that swallowed the mana cost: key covers most of the line -> hit.
    hits = match_names([("Wurmcoil Engine 6", 0.95)], table)
    assert hits and hits[0].key == "wurmcoil engine"
    # A long unrelated sentence containing the key: coverage too low -> no hit.
    assert (
        match_names([("the wurmcoil engine is put into a graveyard from anywhere", 0.95)], table)
        == []
    )

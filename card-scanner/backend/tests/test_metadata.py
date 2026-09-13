"""
Tests for app.metadata.face_metadata with hand-written minimal Scryfall JSON.

Each card object carries only the fields the derivation reads (plus a few
distractors), shaped like the bulk-data / API objects documented at
https://scryfall.com/docs/api/cards.
"""

from __future__ import annotations

import pytest

from app.metadata import FACE_LABELS, face_metadata

EXPECTED_KEYS = {
    "layout",
    "lang",
    "printed_name",
    "flavor_name",
    "name_key",
    "face_name_keys",
    "collector_number_norm",
    "collector_number_base",
    "illustration_id",
    "frame",
    "border_color",
    "full_art",
    "textless",
    "promo_types",
}

NORMAL = {
    "id": "c1",
    "name": "Lightning Bolt",
    "layout": "normal",
    "lang": "en",
    "set": "m10",
    "collector_number": "146",
    "illustration_id": "ill-bolt",
    "frame": "2003",
    "border_color": "black",
    "full_art": False,
    "textless": False,
    "image_uris": {"normal": "https://cards/bolt.jpg"},
}

SPLIT = {
    "id": "c2",
    "name": "Armed // Dangerous",
    "layout": "split",
    "lang": "en",
    "set": "dgm",
    "collector_number": "122",
    "illustration_id": "ill-armed",
    "frame": "2003",
    "border_color": "black",
    "image_uris": {"normal": "https://cards/armed.jpg"},
    "card_faces": [
        {"name": "Armed", "illustration_id": "ill-armed"},
        {"name": "Dangerous", "illustration_id": "ill-dangerous"},
    ],
}

ADVENTURE = {
    "id": "c3",
    "name": "Bonecrusher Giant // Stomp",
    "layout": "adventure",
    "lang": "en",
    "set": "eld",
    "collector_number": "115",
    "illustration_id": "ill-giant",
    "frame": "2015",
    "border_color": "black",
    "image_uris": {"normal": "https://cards/giant.jpg"},
    "card_faces": [{"name": "Bonecrusher Giant"}, {"name": "Stomp"}],
}

TRANSFORM = {
    "id": "c4",
    "name": "Delver of Secrets // Insectile Aberration",
    "layout": "transform",
    "lang": "en",
    "set": "isd",
    "collector_number": "51",
    "frame": "2003",
    "border_color": "black",
    "card_faces": [
        {
            "name": "Delver of Secrets",
            "illustration_id": "ill-delver",
            "image_uris": {"normal": "https://cards/delver.jpg"},
        },
        {
            "name": "Insectile Aberration",
            "illustration_id": "ill-insect",
            "image_uris": {"normal": "https://cards/insect.jpg"},
        },
    ],
}

FLAVOR = {
    "id": "c5",
    "name": "Diaochan, Artful Beauty",
    "flavor_name": "Azula, Flame of Ember Island",
    "layout": "normal",
    "lang": "en",
    "set": "tle",
    "collector_number": "0027",
    "illustration_id": "ill-azula",
    "frame": "2015",
    "border_color": "black",
    "promo_types": ["boosterfun"],
    "image_uris": {"normal": "https://cards/azula.jpg"},
}

JAPANESE = {
    "id": "c6",
    "name": "Counterspell",
    "printed_name": "対抗呪文",
    "layout": "normal",
    "lang": "ja",
    "set": "sta",
    "collector_number": "76",
    "illustration_id": "ill-cs-ja",
    "frame": "2015",
    "border_color": "borderless",
    "full_art": True,
    "promo_types": ["etched"],
    "image_uris": {"normal": "https://cards/cs.jpg"},
}


def test_normal_card_all_keys():
    meta = face_metadata(NORMAL, "single")
    assert set(meta) == EXPECTED_KEYS
    assert meta["layout"] == "normal"
    assert meta["lang"] == "en"
    assert meta["printed_name"] is None
    assert meta["flavor_name"] is None
    assert meta["name_key"] == "lightning bolt"
    assert meta["face_name_keys"] == ["lightning bolt"]
    assert meta["collector_number_norm"] == "146"
    assert meta["collector_number_base"] == "146"
    assert meta["illustration_id"] == "ill-bolt"
    assert meta["frame"] == "2003"
    assert meta["border_color"] == "black"
    assert meta["full_art"] is False
    assert meta["textless"] is False
    assert meta["promo_types"] == []


def test_split_card_single_face_keys_include_halves():
    meta = face_metadata(SPLIT, "single")
    assert meta["name_key"] == "armed dangerous"
    assert meta["face_name_keys"] == ["armed dangerous", "armed", "dangerous"]
    assert meta["illustration_id"] == "ill-armed"
    assert meta["layout"] == "split"


def test_adventure_card_keys():
    meta = face_metadata(ADVENTURE, "single")
    assert meta["name_key"] == "bonecrusher giant stomp"
    assert meta["face_name_keys"] == ["bonecrusher giant stomp", "bonecrusher giant", "stomp"]
    assert meta["layout"] == "adventure"


def test_transform_front_and_back_use_their_own_face():
    front = face_metadata(TRANSFORM, "front")
    back = face_metadata(TRANSFORM, "back")

    assert front["name_key"] == "delver of secrets"
    assert front["face_name_keys"] == ["delver of secrets"]
    assert front["illustration_id"] == "ill-delver"

    assert back["name_key"] == "insectile aberration"
    assert back["face_name_keys"] == ["insectile aberration"]
    assert back["illustration_id"] == "ill-insect"

    # Card-level fields are shared by both faces.
    for meta in (front, back):
        assert meta["layout"] == "transform"
        assert meta["collector_number_norm"] == "51"
        assert meta["frame"] == "2003"
        assert set(meta) == EXPECTED_KEYS


def test_face_falls_back_to_card_level_fields():
    card = {
        **TRANSFORM,
        "printed_name": "Card-level printed",
        "illustration_id": "ill-card",
        "card_faces": [{"name": "Front Only"}, {"name": "Back Only"}],
    }
    front = face_metadata(card, "front")
    assert front["printed_name"] == "Card-level printed"
    assert front["illustration_id"] == "ill-card"
    assert front["face_name_keys"] == ["front only", "card level printed"]


def test_missing_face_falls_back_to_card_name():
    card = {**NORMAL, "card_faces": []}
    back = face_metadata(card, "back")
    assert back["name_key"] == "lightning bolt"


def test_flavor_name_card_answers_to_both_names():
    meta = face_metadata(FLAVOR, "single")
    assert meta["name_key"] == "diaochan artful beauty"
    assert meta["face_name_keys"] == ["diaochan artful beauty", "azula flame of ember island"]
    assert meta["flavor_name"] == "Azula, Flame of Ember Island"
    assert meta["collector_number_norm"] == "27"
    assert meta["collector_number_base"] == "27"
    assert meta["promo_types"] == ["boosterfun"]


def test_japanese_printed_name_is_stored_but_not_a_key():
    meta = face_metadata(JAPANESE, "single")
    assert meta["lang"] == "ja"
    assert meta["printed_name"] == "対抗呪文"
    assert meta["face_name_keys"] == ["counterspell"]
    assert meta["full_art"] is True
    assert meta["border_color"] == "borderless"
    assert meta["promo_types"] == ["etched"]


def test_latin_printed_name_on_a_face_becomes_a_key():
    card = {
        **TRANSFORM,
        "lang": "de",
        "card_faces": [
            {"name": "Delver of Secrets", "printed_name": "Geheimnis-Erforscher"},
            {"name": "Insectile Aberration", "printed_name": "Insektenartige Abnormität"},
        ],
    }
    front = face_metadata(card, "front")
    assert front["printed_name"] == "Geheimnis-Erforscher"
    assert front["face_name_keys"] == ["delver of secrets", "geheimnis erforscher"]
    back = face_metadata(card, "back")
    assert back["face_name_keys"] == ["insectile aberration", "insektenartige abnormitat"]


def test_split_card_face_printed_names_are_keys_when_latin():
    card = {
        **SPLIT,
        "lang": "es",
        "card_faces": [
            {"name": "Armed", "printed_name": "Armado"},
            {"name": "Dangerous", "printed_name": "Peligroso"},
        ],
    }
    meta = face_metadata(card, "single")
    assert meta["face_name_keys"] == [
        "armed dangerous",
        "armed",
        "dangerous",
        "armado",
        "peligroso",
    ]


@pytest.mark.parametrize(
    ("raw", "norm", "base"),
    [
        ("0117", "117", "117"),
        ("223★", "223", "223"),
        ("150s", "150s", "150"),
        ("A-219", "a-219", "a-219"),
        ("AKH-213", "akh-213", "akh-213"),  # The List (PLST) style numbers
    ],
)
def test_collector_number_forms(raw, norm, base):
    meta = face_metadata({**NORMAL, "collector_number": raw}, "single")
    assert meta["collector_number_norm"] == norm
    assert meta["collector_number_base"] == base


def test_missing_optional_fields_default_safely():
    meta = face_metadata({"name": "Fog"}, "single")
    assert meta["name_key"] == "fog"
    assert meta["face_name_keys"] == ["fog"]
    assert meta["collector_number_norm"] == ""
    assert meta["collector_number_base"] == ""
    assert meta["illustration_id"] is None
    assert meta["layout"] is None
    assert meta["full_art"] is False
    assert meta["promo_types"] == []


def test_unknown_face_label_rejected():
    assert FACE_LABELS == ("single", "front", "back")
    with pytest.raises(ValueError):
        face_metadata(NORMAL, "middle")

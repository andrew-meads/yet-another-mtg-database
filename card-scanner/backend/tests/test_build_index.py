"""
Tests for the pure parts of ``app.build_index``: face resolution, set eligibility,
the TTY-aware status block and the error log. Scryfall HTTP helpers are not tested
here (they are being moved into their own module).
"""

from __future__ import annotations

import pytest

from app import build_index, config


@pytest.fixture(autouse=True)
def _image_format(monkeypatch):
    """Pin the image size so the expected URLs do not depend on the environment."""
    monkeypatch.setattr(config, "SCRYFALL_IMAGE_FORMAT", "normal")


# --- _faces_for -----------------------------------------------------------------------


def test_faces_for_single_image_card():
    card = {"name": "Lightning Bolt", "image_uris": {"normal": "https://img/bolt.jpg"}}
    assert build_index._faces_for(card) == [("single", "https://img/bolt.jpg", "Lightning Bolt")]


def test_faces_for_transform_dfc_yields_front_and_back_with_face_names():
    card = {
        "name": "Delver of Secrets // Insectile Aberration",
        "card_faces": [
            {"name": "Delver of Secrets", "image_uris": {"normal": "https://img/front.jpg"}},
            {"name": "Insectile Aberration", "image_uris": {"normal": "https://img/back.jpg"}},
        ],
    }
    assert build_index._faces_for(card) == [
        ("front", "https://img/front.jpg", "Delver of Secrets"),
        ("back", "https://img/back.jpg", "Insectile Aberration"),
    ]


def test_faces_for_split_card_is_one_face():
    """Split/adventure cards have per-face metadata but a single top-level image, so
    they must index as one face named after the whole card."""
    card = {
        "name": "Fire // Ice",
        "image_uris": {"normal": "https://img/fire-ice.jpg"},
        "card_faces": [{"name": "Fire"}, {"name": "Ice"}],
    }
    assert build_index._faces_for(card) == [("single", "https://img/fire-ice.jpg", "Fire // Ice")]


def test_faces_for_card_without_images():
    assert build_index._faces_for({"name": "Digital Only"}) == []
    assert build_index._faces_for({"name": "Faces No Art", "card_faces": [{"name": "A"}]}) == []


def test_faces_for_missing_size_gives_none_url():
    """A card lacking the configured size yields a ``None`` URL, which index_set skips."""
    card = {"name": "Tiny", "image_uris": {"small": "https://img/small.jpg"}}
    assert build_index._faces_for(card) == [("single", None, "Tiny")]


# --- _eligible_english_sets --------------------------------------------------------------


def test_eligible_sets_drop_excluded_types_and_empty_sets(monkeypatch):
    monkeypatch.setattr(config, "EXCLUDED_SET_TYPES", {"token", "minigame"})
    sets = [
        {"code": "tla", "set_type": "expansion", "card_count": 300},
        {"code": "ttla", "set_type": "token", "card_count": 20},
        {"code": "ttle", "set_type": "token", "card_count": 10},
        {"code": "mini", "set_type": "minigame", "card_count": 5},
        {"code": "empty", "set_type": "core", "card_count": 0},
        {"code": "nocount", "set_type": "core"},
        {"code": "promo", "set_type": "promo", "card_count": 1},
    ]

    eligible, excluded = build_index._eligible_english_sets(sets)

    assert [s["code"] for s in eligible] == ["tla", "promo"]
    assert excluded == {"token": 2, "minigame": 1}


def test_eligible_sets_empty_input():
    assert build_index._eligible_english_sets([]) == ([], {})


# --- LiveStatus ----------------------------------------------------------------------------


def test_live_status_is_disabled_off_tty(capsys):
    """Under capture stdout is not a TTY, so nothing (no escape codes) may be written."""
    status = build_index.LiveStatus()
    status.render(["line one", "line two"])
    status.finish()

    assert status.enabled is False
    assert capsys.readouterr().out == ""


def test_live_status_redraws_in_place_when_enabled(capsys):
    """Force-enable to check the redraw protocol: the second render jumps back up over
    the previously drawn block and clears each line before rewriting it."""
    status = build_index.LiveStatus()
    status.enabled = True

    status.render(["a", "b"])
    first = capsys.readouterr().out
    status.render(["c", "d", "e"])
    second = capsys.readouterr().out
    status.finish()
    status.render(["f"])
    third = capsys.readouterr().out

    assert first == "\033[2Ka\n\033[2Kb\n"
    assert second.startswith("\033[2F")  # cursor up two lines: the block had 2
    assert second.count("\033[2K") == 3
    # finish() forgot the block, so the next render must not move the cursor up.
    assert third == "\033[2Kf\n"


# --- ErrorLog -----------------------------------------------------------------------------


def test_error_log_counts_and_writes_session_header(tmp_path):
    path = tmp_path / "logs" / "index_errors.log"  # parent does not exist yet
    log = build_index.ErrorLog(path)
    assert log.count == 0
    assert not path.exists()  # opened lazily: a clean build leaves no file

    log.record("set=abc card='One' — image decode returned None")
    try:
        raise ValueError("boom")
    except ValueError as err:
        log.record("set=abc card='Two'", exc=err)
    log.close()

    assert log.count == 2
    text = path.read_text()
    assert text.count("===== index build run ") == 1
    assert "card='One' — image decode returned None" in text
    assert "card='Two'" in text
    assert "Traceback" in text and "ValueError: boom" in text


def test_error_log_appends_across_sessions(tmp_path):
    path = tmp_path / "err.log"
    for _ in range(2):
        log = build_index.ErrorLog(path)
        log.record("ctx")
        log.close()

    assert path.read_text().count("===== index build run ") == 2

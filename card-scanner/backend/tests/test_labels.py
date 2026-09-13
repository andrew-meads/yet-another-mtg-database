"""Tests for the ground-truth manifest tooling in ``app.labels`` (no Postgres)."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from app import geometry, labels

REAL_DATASET = Path(__file__).resolve().parents[2] / "test-images"


# --- fixtures -----------------------------------------------------------------------


def _write_jpeg(path: Path, w: int = 400, h: int = 300) -> None:
    cv2.imwrite(str(path), np.full((h, w, 3), 240, np.uint8))


@pytest.fixture
def dataset(tmp_path: Path) -> Path:
    """A minimal valid dataset: one 400x300 photo and one manifest entry."""
    _write_jpeg(tmp_path / "01-one.jpg")
    manifest = [
        {
            "fileName": "01-one.jpg",
            "description": "one card",
            "cards": [{"name": "Fog", "set": "M12", "number": "0172"}],
        }
    ]
    labels.save_manifest(manifest, tmp_path)
    return tmp_path


def _row(rid, sid, oid, name, set_code, cn, face="single"):
    return {
        "id": rid,
        "scryfall_id": sid,
        "oracle_id": oid,
        "name": name,
        "set_code": set_code,
        "collector_number": cn,
        "face": face,
    }


@pytest.fixture
def maps() -> labels.IndexMaps:
    """A hand-built index covering every resolution rule."""
    return labels.IndexMaps.from_rows(
        [
            _row(1, "sid-rise", "oid-rise", "The Rise of Sozin", "tla", "117"),
            _row(2, "sid-ran", "oid-ran", "Ran and Shaw", "tla", "150"),
            _row(3, "sid-ran-pre", "oid-ran", "Ran and Shaw", "tla", "150s"),
            _row(4, "sid-wurm-promo", "oid-wurm", "Wurmcoil Engine", "som", "223★"),
            _row(5, "sid-wurm-promo2", "oid-wurm", "Wurmcoil Engine", "som", "223p"),
            _row(6, "sid-pyro", "oid-pyro", "Pyroclasm", "ice", "214"),
            _row(7, "sid-wall", "oid-wall", "Wall of Roots", "mir", "253"),
            _row(8, "sid-dia", "oid-dia", "Diaochan, Artful Beauty", "tle", "27"),
            _row(9, "sid-aang", "oid-aang", "Aang, Swift Savior", "tla", "204", "front"),
            _row(10, "sid-aang", "oid-aang", "Aang and La, Ocean's Fury", "tla", "204", "back"),
            _row(11, "sid-fog-a", "oid-fog", "Fog", "m12", "172"),
            _row(12, "sid-fog-b", "oid-fog", "Fog", "m13", "172"),
            _row(13, "sid-forest-1", "oid-forest", "Forest", "tla", "290"),
            _row(14, "sid-forest-2", "oid-forest", "Forest", "tla", "291"),
        ]
    )


# --- manifest I/O -----------------------------------------------------------------------


def test_manifest_round_trip_preserves_unknown_keys_and_order(tmp_path: Path):
    entries = [
        {
            "fileName": "01-a.jpg",
            "zeta": {"nested": [1, 2, 3]},  # unknown key, early in the order
            "description": "d",
            "cards": [{"name": "Wurzelmauer", "extra": "★ signed", "set": "MIR", "alpha": True}],
        }
    ]
    path = labels.save_manifest(entries, tmp_path)
    text = path.read_text(encoding="utf-8")
    assert text.endswith("\n") and "\\u" not in text  # ensure_ascii=False keeps ★ readable
    loaded = labels.load_manifest(tmp_path)  # directory form
    assert loaded == entries
    assert list(loaded[0]) == ["fileName", "zeta", "description", "cards"]
    assert list(loaded[0]["cards"][0]) == ["name", "extra", "set", "alpha"]
    assert labels.load_manifest(path) == entries  # file form
    assert labels.dataset_dir(path) == tmp_path and labels.manifest_path(tmp_path) == path


def test_save_manifest_compacts_quads_but_stays_json(tmp_path: Path):
    entries = [
        {
            "fileName": "x.jpg",
            "cards": [
                {
                    "name": "n",
                    "set": "s",
                    "quad": [[1, 2], [3, 4], [5, 6], [7, 8]],
                    "quadSource": "draft",
                }
            ],
        }
    ]
    text = labels.save_manifest(entries, tmp_path).read_text()
    assert "[1, 2]," in text and json.loads(text) == entries


def test_load_manifest_errors(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        labels.load_manifest(tmp_path)
    (tmp_path / labels.MANIFEST_NAME).write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError):
        labels.load_manifest(tmp_path)
    (tmp_path / labels.MANIFEST_NAME).write_text('{"a": 1}', encoding="utf-8")
    with pytest.raises(ValueError):
        labels.load_manifest(tmp_path)


def test_entry_helpers():
    assert labels.entry_prefix({"fileName": "07-8-sideways-cards.jpg"}) == "07"
    assert labels.entry_prefix({"fileName": "photo.jpg"}) is None
    assert labels.entry_kind({}) == "photo" and labels.entry_kind({"kind": "crop"}) == "crop"
    assert labels.entry_background({}) == "unknown"
    assert labels.card_quad({}) is None
    q = labels.card_quad({"quad": [[1, 2], [3, 4], [5, 6], [7, 8]]})
    assert q.shape == (4, 2) and q.dtype == np.float32
    assert labels.quad_to_json(np.array([[1.4, 2.6], [3, 4], [5, 6], [7, 8]])) == [
        [1, 3],
        [3, 4],
        [5, 6],
        [7, 8],
    ]
    assert labels.is_verified({"quad": q.tolist(), "quadSource": "verified"})
    assert not labels.is_verified({"quad": q.tolist(), "quadSource": "draft"})
    assert not labels.is_verified({})


# --- validation -----------------------------------------------------------------------


def test_validate_ok(dataset: Path):
    assert labels.validate_manifest(labels.load_manifest(dataset), dataset) == []


def _problems(dataset: Path, mutate) -> list[str]:
    entries = labels.load_manifest(dataset)
    mutate(entries)
    return labels.validate_manifest(entries, dataset)


def _card(entries):
    return entries[0]["cards"][0]


@pytest.mark.parametrize(
    "mutate, expect",
    [
        (lambda e: e[0].pop("fileName"), "'fileName' is required"),
        (lambda e: e[0].update(fileName="missing.jpg"), "file not found"),
        (lambda e: e.append(dict(e[0])), "duplicate fileName"),
        (lambda e: e[0].update(kind="video"), "'kind' must be one of"),
        (lambda e: e[0].update(tags="a,b"), "'tags' must be a list"),
        (lambda e: e[0].update(background=3), "'background' must be a string"),
        (lambda e: e[0].update(lighting=3), "'lighting' must be a string"),
        (lambda e: e[0].update(description=[]), "'description' must be a string"),
        (lambda e: e[0].update(cards="x"), "'cards' must be a list"),
        (lambda e: e[0]["cards"].append("x"), "card must be an object"),
        (lambda e: _card(e).pop("name"), "'name' is required"),
        (lambda e: _card(e).update(name="   "), "'name' is required"),
        (lambda e: _card(e).pop("set"), "'set' is required unless anyPrintingOk"),
        (lambda e: _card(e).update(set=""), "'set' must be a non-empty string"),
        (lambda e: _card(e).update(number=117), "'number' must be a string"),
        (lambda e: _card(e).update(lang=1), "'lang' must be a string"),
        (lambda e: _card(e).update(sleeved="yes"), "'sleeved' must be true/false"),
        (lambda e: _card(e).update(scryfallId=5), "'scryfallId' must be a string"),
        (lambda e: _card(e).update(collectorLine=5), "'collectorLine' must be a string"),
        (
            lambda e: _card(e).update(quad=[[0, 0], [10, 0], [10, 10], [0, 10]]),
            "'quad' and 'quadSource' must be present together",
        ),
        (
            lambda e: _card(e).update(quadSource="draft"),
            "'quad' and 'quadSource' must be present together",
        ),
        (
            lambda e: _card(e).update(
                quad=[[0, 0], [10, 0], [10, 10], [0, 10]], quadSource="guess"
            ),
            "'quadSource' must be one of",
        ),
        (
            lambda e: _card(e).update(quad=[[0, 0], [10, 0], [10, 10]], quadSource="draft"),
            "'quad' must be 4 [x, y] number pairs",
        ),
        (
            lambda e: _card(e).update(
                quad=[[0, 0], [10, "a"], [10, 10], [0, 10]], quadSource="draft"
            ),
            "'quad' must be 4 [x, y] number pairs",
        ),
        (
            lambda e: _card(e).update(
                quad=[[0, 0], [10, 10], [10, 0], [0, 10]], quadSource="draft"
            ),
            "not a convex quadrilateral",
        ),
        (
            lambda e: (
                _card(e).update(
                    quad=[
                        [0, 0],
                        [10, 0],
                        [10, 10],
                        [0, 10],
                    ],
                    quadSource="draft",
                )
                or _card(e).update(quad=[[-1, 0], [10, 0], [10, 10], [0, 10]])
            ),
            "outside the 400x300 frame",
        ),
        (
            lambda e: _card(e).update(
                quad=[[0, 0], [500, 0], [500, 10], [0, 10]], quadSource="draft"
            ),
            "outside the 400x300 frame",
        ),
        (lambda e: e[0].update(kind="crop", cards=[]), "must list exactly one card"),
        (
            lambda e: (
                e[0].update(kind="crop")
                or _card(e).update(quad=[[0, 0], [10, 0], [10, 10], [0, 10]], quadSource="draft")
            ),
            "must not carry quads",
        ),
    ],
)
def test_validate_each_error(dataset: Path, mutate, expect):
    problems = _problems(dataset, mutate)
    assert any(expect in p for p in problems), problems


def test_validate_any_printing_ok_without_set(dataset: Path):
    assert (
        _problems(dataset, lambda e: _card(e).update(anyPrintingOk=True) or _card(e).pop("set"))
        == []
    )


def test_validate_not_a_list_and_bad_entry(dataset: Path):
    assert labels.validate_manifest({"a": 1}, dataset) == ["manifest must be a JSON array"]
    assert labels.validate_manifest(["x"], dataset) == ["entry[0]: must be an object"]


def test_validate_unreadable_image(dataset: Path):
    (dataset / "01-one.jpg").write_bytes(b"not an image")
    assert any("not a readable image" in p for p in _problems(dataset, lambda e: None))


def test_image_frame_size_honours_exif_orientation(tmp_path: Path):
    from PIL import Image

    im = Image.new("RGB", (400, 300))
    plain = tmp_path / "plain.jpg"
    im.save(plain)
    assert labels.image_frame_size(plain) == (400, 300)
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° → the decoded frame is portrait
    rotated = tmp_path / "rotated.jpg"
    im.save(rotated, exif=exif)
    assert labels.image_frame_size(rotated) == (300, 400)
    assert labels.image_frame_size(tmp_path / "nope.jpg") is None


@pytest.mark.skipif(not REAL_DATASET.is_dir(), reason="real test-images not checked out")
def test_real_manifest_validates_offline():
    entries = labels.load_manifest(REAL_DATASET)
    assert labels.validate_manifest(entries, REAL_DATASET) == []
    assert len(entries) >= 7  # the user keeps adding photos; the first seven are fixed
    assert all(e.get("background") == "white-paper" for e in entries[:7])
    cards = [c for e in entries for c in e["cards"]]
    assert len(cards) >= 22
    assert all(labels.is_verified(c) for c in cards)
    assert [c for c in cards if c["name"] == "Wurzelmauer"][0]["lang"] == "de"


# --- normalisation + IndexMaps -------------------------------------------------------


def test_normalizers():
    assert labels.normalize_set(" TLA ") == "tla" and labels.normalize_set(None) == ""
    assert labels.normalize_number("0117") == "117"
    assert labels.normalize_number("0") == "0" and labels.normalize_number("000") == "0"
    assert labels.normalize_number("57A") == "57a"
    assert labels.normalize_number("A-219") == "a-219"
    assert labels.base_number("223★") == "223"
    assert labels.base_number("0150s") == "150"
    assert labels.base_number("271p") == "271"
    assert labels.base_number("★") == "★"
    assert labels.normalize_name("  The   Rise of  Sozin ") == "the rise of sozin"


def test_index_maps_lookups(maps: labels.IndexMaps):
    assert maps.size == 14
    assert [r.row_id for r in maps.by_set_number[("tla", "150")]] == [2]
    assert {r.row_id for r in maps.by_set_base[("tla", "150")]} == {2, 3}
    assert {r.row_id for r in maps.by_set_base[("som", "223")]} == {4, 5}
    assert [r.row_id for r in maps.by_scryfall_id["sid-aang"]] == [9, 10]
    assert maps.oracle_of("sid-aang") == "oid-aang" and maps.oracle_of("nope") is None
    assert "pyroclasm" in maps.names_by_set["ice"]
    assert {r.set_code for r in maps.by_name["fog"]} == {"m12", "m13"}
    # IndexRow inputs are accepted too.
    again = labels.IndexMaps.from_rows(maps.rows)
    assert again.by_set_number.keys() == maps.by_set_number.keys()


# --- resolve_expected -------------------------------------------------------------------


def test_resolve_exact_with_leading_zeros_and_case(maps):
    res = labels.resolve_expected(
        {"name": "The Rise of Sozin", "set": "TLA", "number": "0117"}, maps
    )
    assert res.resolved and res.how == "exact" and res.warning is None
    assert (res.row_id, res.scryfall_id, res.oracle_id) == (1, "sid-rise", "oid-rise")
    assert (
        res.set_code == "tla" and res.collector_number == "117" and res.name == "The Rise of Sozin"
    )


def test_resolve_exact_beats_family_twin(maps):
    res = labels.resolve_expected({"name": "Ran and Shaw", "set": "TLA", "number": "0150"}, maps)
    assert res.how == "exact" and res.scryfall_id == "sid-ran"


def test_resolve_promo_family(maps):
    res = labels.resolve_expected({"name": "Wurmcoil Engine", "set": "SOM", "number": "223"}, maps)
    assert res.how == "family" and res.oracle_id == "oid-wurm"
    # Same-length twins: the lexicographically smaller number ("223p" < "223★") wins.
    assert res.scryfall_id == "sid-wurm-promo2"
    assert res.warning and "base-number family" in res.warning and "223p" in res.warning
    # A cached scryfallId picks the other twin.
    res = labels.resolve_expected(
        {"name": "Wurmcoil Engine", "set": "SOM", "number": "223", "scryfallId": "sid-wurm-promo"},
        maps,
    )
    assert res.how == "family" and res.scryfall_id == "sid-wurm-promo"


def test_resolve_no_number_by_name(maps):
    res = labels.resolve_expected({"name": "Pyroclasm", "set": "ICE"}, maps)
    assert res.how == "name" and res.scryfall_id == "sid-pyro"
    assert res.warning and "no number given" in res.warning


def test_resolve_name_en_for_foreign_card(maps):
    card = {"name": "Wurzelmauer", "name-en": "Wall of Roots", "set": "MIR"}
    res = labels.resolve_expected(card, maps)
    assert res.how == "name" and res.scryfall_id == "sid-wall"
    assert "'Wall of Roots'" in res.warning


def test_resolve_flavor_name(maps):
    card = {
        "name": "Azula, Flame of Ember Island",
        "flavorName": "Diaochan, Artful Beauty",
        "set": "TLE",
    }
    res = labels.resolve_expected(card, maps)
    assert res.how == "name" and res.scryfall_id == "sid-dia"


def test_resolve_saviour_spelling_and_dfc_face(maps):
    res = labels.resolve_expected({"name": "Aang, Swift Saviour", "set": "TLA"}, maps)
    assert res.how == "name" and res.scryfall_id == "sid-aang" and res.row_id == 9
    # With the exact number the front face is still chosen by name.
    res = labels.resolve_expected(
        {"name": "Aang, Swift Saviour", "set": "tla", "number": "0204"}, maps
    )
    assert res.how == "exact" and res.row_id == 9
    # Naming the back face selects it.
    res = labels.resolve_expected(
        {"name": "Aang and La, Ocean's Fury", "set": "tla", "number": "204"}, maps
    )
    assert res.how == "exact" and res.row_id == 10


def test_resolve_number_not_indexed_falls_back_to_name_with_warning(maps):
    res = labels.resolve_expected({"name": "Pyroclasm", "set": "ICE", "number": "999"}, maps)
    assert res.how == "name" and res.scryfall_id == "sid-pyro"
    assert "number '999' not indexed" in res.warning


def test_resolve_ambiguous_name_warns(maps):
    res = labels.resolve_expected({"name": "Forest", "set": "TLA"}, maps)
    assert res.how == "name" and res.scryfall_id == "sid-forest-1"
    assert "ambiguous printings" in res.warning


def test_resolve_any_printing_ok_without_set(maps):
    res = labels.resolve_expected({"name": "Fog", "anyPrintingOk": True}, maps)
    assert res.how == "name-any-set" and res.oracle_id == "oid-fog"
    assert "anyPrintingOk" in res.warning


def test_resolve_cached_scryfall_id_last(maps):
    res = labels.resolve_expected({"name": "Unknown", "set": "xyz", "scryfallId": "sid-pyro"}, maps)
    assert res.how == "scryfall-id" and res.scryfall_id == "sid-pyro"
    assert "cached scryfallId" in res.warning


def test_resolve_unresolved(maps):
    res = labels.resolve_expected({"name": "Black Lotus", "set": "LEA", "number": "232"}, maps)
    assert not res.resolved and res.how == "unresolved"
    assert res.row_id is None and res.scryfall_id is None and res.oracle_id is None
    assert res.set_code is None and res.name is None
    assert "not found" in res.warning
    # Fuzzy score below 90 must not match.
    res = labels.resolve_expected({"name": "Pyroclasmic Wurm", "set": "ICE"}, maps)
    assert not res.resolved
    # No set and no anyPrintingOk → unresolved even if the name exists.
    assert not labels.resolve_expected({"name": "Fog"}, maps).resolved


# --- orientation ---------------------------------------------------------------------------


def _card_quad(angle_deg: float) -> np.ndarray:
    """A 63x88 card in printed order, rotated ``angle_deg`` clockwise on screen."""
    a = np.radians(angle_deg)
    c, s = np.cos(a), np.sin(a)
    half = np.array([[-63, -88], [63, -88], [63, 88], [-63, 88]], np.float64) / 2
    rot = np.array([[c, -s], [s, c]])
    return (half @ rot.T + 500).astype(np.float32)


@pytest.mark.parametrize(
    "angle, expected",
    [
        (0, "upright"),
        (20, "upright"),
        (-40, "upright"),
        (90, "cw90"),
        (70, "cw90"),
        (-90, "ccw90"),
        (-110, "ccw90"),
        (180, "rot180"),
        (160, "rot180"),
        (-170, "rot180"),
    ],
)
def test_orientation_of(angle, expected):
    assert labels.orientation_of(_card_quad(angle)) == expected


def test_orientation_of_uses_printed_order_not_geometry():
    # Same shape on screen, but the printed TL moved to the bottom-right → rot180.
    upright = _card_quad(0)
    assert labels.orientation_of(np.roll(upright, 2, axis=0)) == "rot180"
    assert labels.orientation_of(np.roll(upright, 1, axis=0)) == "ccw90"
    assert labels.orientation_of(np.roll(upright, 3, axis=0)) == "cw90"


# --- printed_order_from_detection ------------------------------------------------------------


def test_printed_order_shifts():
    q = geometry.order_points(_card_quad(0))
    np.testing.assert_array_equal(labels.printed_order_from_detection(q, False, False), q)
    np.testing.assert_array_equal(
        labels.printed_order_from_detection(q, False, True), np.roll(q, 2, 0)
    )
    np.testing.assert_array_equal(
        labels.printed_order_from_detection(q, True, False), np.roll(q, 1, 0)
    )
    np.testing.assert_array_equal(
        labels.printed_order_from_detection(q, True, True), np.roll(q, 3, 0)
    )
    # Landscape: index 0 is the geometric bottom-left (rotated 90° CW into the crop's TL).
    out = labels.printed_order_from_detection(q, True, False)
    np.testing.assert_array_equal(out[0], q[3])
    assert out.dtype == np.float32


def _rotate_points(pts: np.ndarray, code: int, h: int, w: int) -> np.ndarray:
    """Map points through the same rotation ``cv2.rotate(img, code)`` applies to pixels."""
    x, y = pts[:, 0], pts[:, 1]
    if code == cv2.ROTATE_90_CLOCKWISE:
        return np.stack([h - 1 - y, x], axis=1)
    if code == cv2.ROTATE_180:
        return np.stack([w - 1 - x, h - 1 - y], axis=1)
    if code == cv2.ROTATE_90_COUNTERCLOCKWISE:
        return np.stack([y, w - 1 - x], axis=1)
    raise ValueError(code)


@pytest.mark.parametrize(
    "code", [None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE]
)
def test_printed_order_end_to_end_with_the_real_warp_and_rotation(code):
    """Draw a card with a marker at its printed top-left, photograph it at four
    orientations, run the detector's warp + portrait rule, and check that the
    index-0 corner returned is really the marker's corner."""
    h, w = 400, 500
    canvas = np.full((h, w, 3), 230, np.uint8)
    printed = np.array([[150, 100], [290, 100], [290, 300], [150, 300]], np.float32)
    cv2.fillPoly(canvas, [printed.astype(np.int32)], (40, 40, 40))
    cv2.circle(canvas, (165, 115), 8, (255, 255, 255), -1)  # marker near printed TL

    if code is not None:
        canvas = cv2.rotate(canvas, code)
        printed = _rotate_points(printed, code, h, w).astype(np.float32)

    geometric = geometry.order_points(printed)
    warped = geometry.four_point_transform(canvas, geometric)
    ww, wh = geometry.warp_size(geometric)
    landscape = ww > wh
    if landscape:
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)  # detection._normalize_to_card
    # Where did the marker land in the portrait crop? Top half = upright, bottom = flipped.
    ys, xs = np.where(warped[:, :, 0] > 200)
    flipped = ys.mean() > warped.shape[0] / 2
    assert (xs.mean() < warped.shape[1] / 2) != flipped  # TL or BR, never the other two

    out = labels.printed_order_from_detection(geometric, landscape, flipped)
    np.testing.assert_allclose(out[0], printed[0], atol=1e-3)
    np.testing.assert_allclose(out, printed, atol=1e-3)

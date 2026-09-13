"""Tests for the synthetic card / background / composite generator (app.synth).

Pure CPU: no network, no Postgres, no image cache (fake cards only). The tests
pin the properties the detection harness and a future learned detector rely on:
determinism from a seed, exact in-frame convex quads in printed order, the
overlap constraint, the manifest schema, and fake cards being distinguishable.
"""

from __future__ import annotations

import json
from itertools import combinations
from pathlib import Path

import cv2
import numpy as np
import pytest

from app import hashing, synth


def _rng(seed: int = 0) -> np.random.Generator:
    return np.random.default_rng(seed)


def _small_params(**overrides) -> synth.SynthParams:
    """Fast params for tests: small canvas, few cards."""
    base = synth.SynthParams(long_edge=480, min_cards=1, max_cards=4, preset="test")
    return synth.replace(base, **overrides)


def _cyclic_convex(quad) -> bool:
    return synth._is_convex(np.asarray(quad, np.float32))


# --- procedural primitives ------------------------------------------------------


@pytest.mark.parametrize("kind", synth.BACKGROUND_KINDS)
def test_procedural_background_shape_and_dtype(kind):
    img = synth.procedural_background(_rng(1), 160, 120, kind)
    assert img.shape == (120, 160, 3)
    assert img.dtype == np.uint8


def test_procedural_background_rejects_unknown_kind():
    with pytest.raises(ValueError):
        synth.procedural_background(_rng(), 32, 32, "lava")


def test_make_fake_card_defaults_to_output_crop_size():
    from app import config

    card = synth.make_fake_card(_rng(3), 3)
    assert card.shape == (config.OUTPUT_HEIGHT, config.OUTPUT_WIDTH, 3)
    assert card.dtype == np.uint8
    # Corners are rounded: the exact corner pixel is outside the card (white).
    assert tuple(card[0, 0]) == (255, 255, 255)
    # ...but the border just inside the rounding is black.
    assert card[card.shape[0] // 2, 1].max() < 40


def test_fake_cards_are_pairwise_distinct_in_phash():
    hashes = [hashing.compute_phash(synth.make_fake_card(_rng(100 + i), i)) for i in range(30)]
    min_dist = min((a ^ b).bit_count() for a, b in combinations(hashes, 2))
    assert min_dist >= 8, f"closest pair of fake cards is only {min_dist} bits apart"


def test_rounded_rect_mask_corners_transparent():
    mask = synth.rounded_rect_mask(100, 140)
    assert mask.shape == (140, 100)
    assert mask[0, 0] == 0 and mask[139, 99] == 0
    assert mask[70, 50] == 255 and mask[0, 50] == 255


# --- placement --------------------------------------------------------------------


def test_sample_placement_inside_and_convex_for_every_mode():
    rng = _rng(7)
    canvas = (300, 400)
    for mode in synth.ROTATION_MODES:
        for _ in range(50):
            quad = synth.sample_placement(canvas, (680, 487), rng, rotation_mode=mode)
            assert quad.shape == (4, 2)
            assert (quad[:, 0] >= 0).all() and (quad[:, 0] <= 399).all()
            assert (quad[:, 1] >= 0).all() and (quad[:, 1] <= 299).all()
            assert _cyclic_convex(quad)


def test_sample_placement_upright_keeps_printed_order():
    """With no jitter and no rotation, printed order is literally TL, TR, BR, BL."""
    quad = synth.sample_placement(
        (600, 800), (680, 487), _rng(5), rotation_mode="upright", perspective_jitter=0.0
    )
    tl, tr, br, bl = quad
    assert tl[0] < tr[0] and bl[0] < br[0]  # left of right
    assert tl[1] < bl[1] and tr[1] < br[1]  # top above bottom
    # Portrait card: the TL->TR edge is the short one.
    assert np.linalg.norm(tr - tl) < np.linalg.norm(bl - tl)


def test_sample_placement_rejects_unknown_rotation_mode():
    with pytest.raises(ValueError):
        synth.sample_placement((100, 100), (68, 48), _rng(), rotation_mode="sideways")


def test_place_card_returns_image_of_card_corner_zero():
    """quad[0] must be where the card's own (0,0) corner landed, whatever the rotation.

    A card that is black except for a red patch just inside its top-left corner is
    placed with an arbitrary rotation; the canvas pixel a little inside quad[0]
    (toward the centroid) must be red, and the pixel inside quad[2] (the printed
    bottom-right) must not.
    """
    card = np.zeros((680, 487, 3), np.uint8)
    card[:120, :120] = (0, 0, 255)  # BGR red in the printed top-left
    for seed in range(6):
        rng = _rng(seed)
        canvas = np.full((600, 800, 3), 128, np.uint8)
        quad = synth.place_card(
            canvas,
            card,
            rng,
            scale_range=(0.4, 0.5),
            rotation_mode="any",
            perspective_jitter=0.05,
            shadow=False,
            glare=0.0,
        )
        centroid = quad.mean(axis=0)
        p0 = quad[0] + (centroid - quad[0]) * 0.12
        p2 = quad[2] + (centroid - quad[2]) * 0.12
        px0 = canvas[int(round(p0[1])), int(round(p0[0]))]
        px2 = canvas[int(round(p2[1])), int(round(p2[0]))]
        assert px0[2] > 200 and px0[0] < 60 and px0[1] < 60, (seed, px0)
        assert px2.max() < 60, (seed, px2)


def test_place_card_keeps_rounded_corners_and_draws_shadow():
    card = np.full((680, 487, 3), 255, np.uint8)  # all-white card, no rounding baked in
    rng = _rng(11)
    canvas = np.full((600, 800, 3), 200, np.uint8)
    before = canvas.copy()
    quad = synth.place_card(
        canvas,
        card,
        rng,
        scale_range=(0.45, 0.45),
        rotation_mode="upright",
        perspective_jitter=0.0,
        shadow=True,
        glare=0.0,
    )
    tl = quad[0]
    # The exact corner pixel is outside the rounded mask, so it is not card-white;
    # a pixel well inside is.
    assert canvas[int(tl[1]) + 1, int(tl[0]) + 1].max() < 250
    centre = quad.mean(axis=0).astype(int)
    assert canvas[centre[1], centre[0]].min() == 255
    # A shadow darkens the background below-right of the card.
    br = quad[2]
    y, x = int(br[1]) + 6, int(br[0]) + 2
    assert canvas[y, x].mean() < before[y, x].mean()


def test_place_card_is_deterministic():
    card = synth.make_fake_card(_rng(1), 1)
    outs = []
    for _ in range(2):
        canvas = np.full((300, 400, 3), 90, np.uint8)
        quad = synth.place_card(canvas, card, _rng(42))
        outs.append((canvas, quad))
    assert np.array_equal(outs[0][0], outs[1][0])
    assert np.array_equal(outs[0][1], outs[1][1])


# --- composition ------------------------------------------------------------------


def test_compose_quads_inside_convex_and_manifest_shape():
    params = _small_params(max_overlap=0.15, rotation_mode="any")
    pool = synth.FakeCardPool(20)
    for seed in range(8):
        image, entry = synth.compose(_rng(seed), params, pool)
        h, w = image.shape[:2]
        assert image.dtype == np.uint8 and max(h, w) == params.long_edge
        assert entry["kind"] == "photo"
        assert entry["background"].startswith("synth:")
        assert "synthetic" in entry["tags"]
        assert 1 <= len(entry["cards"]) <= params.max_cards
        for card in entry["cards"]:
            assert set(card) == {
                "name",
                "set",
                "number",
                "quad",
                "quadSource",
                "occluded",
            }
            assert card["set"] == synth.FAKE_SET_CODE
            assert card["name"] == f"Fake Card {card['number']}"
            assert card["quadSource"] == "verified"
            assert (
                "scryfallId" not in card
            )  # omitted for fake cards (null fails the manifest validator)
            quad = np.array(card["quad"])
            assert quad.shape == (4, 2) and quad.dtype.kind == "i"
            assert (quad[:, 0] >= 0).all() and (quad[:, 0] < w).all()
            assert (quad[:, 1] >= 0).all() and (quad[:, 1] < h).all()
            assert _cyclic_convex(quad)


def test_compose_honours_overlap_limit_and_flags_occlusion():
    pool = synth.FakeCardPool(20)
    # Zero overlap: no pair may intersect at all, and nothing is occluded.
    params = _small_params(max_overlap=0.0, min_cards=3, max_cards=4, scale_range=(0.2, 0.35))
    for seed in range(6):
        _image, entry = synth.compose(_rng(seed), params, pool)
        quads = [np.array(c["quad"], np.float32) for c in entry["cards"]]
        for a, b in combinations(quads, 2):
            assert synth._quad_iou(a, b) == 0.0
        assert not any(c["occluded"] for c in entry["cards"])
        assert "overlap" not in entry["tags"]

    # Bounded overlap: IoU never exceeds the limit; any intersecting earlier card is
    # flagged occluded (later cards are drawn on top).
    params = _small_params(
        max_overlap=0.15, overlap_prob=1.0, min_cards=4, max_cards=4, scale_range=(0.3, 0.5)
    )
    seen_overlap = False
    for seed in range(12):
        _image, entry = synth.compose(_rng(seed), params, pool)
        cards = entry["cards"]
        quads = [np.array(c["quad"], np.float32) for c in cards]
        for i, j in combinations(range(len(quads)), 2):
            assert synth._quad_iou(quads[i], quads[j]) <= 0.15 + 1e-3
            if synth._intersection_area(quads[i], quads[j]) > 0:
                seen_overlap = True
                assert cards[i]["occluded"] is True  # i < j: i is underneath
        if any(c["occluded"] for c in cards):
            assert "overlap" in entry["tags"]
    assert seen_overlap, "test never produced an overlapping pair; loosen the params"

    # overlap_prob=0 makes max_overlap irrelevant: never any intersection.
    params = synth.replace(params, overlap_prob=0.0)
    for seed in range(6):
        _image, entry = synth.compose(_rng(seed), params, pool)
        quads = [np.array(c["quad"], np.float32) for c in entry["cards"]]
        for a, b in combinations(quads, 2):
            assert synth._intersection_area(a, b) == 0.0


def test_compose_solid_dark_background_is_dark():
    params = _small_params(backgrounds=("solid-dark",), min_cards=1, max_cards=1)
    image, entry = synth.compose(_rng(3), params, synth.FakeCardPool(3))
    assert entry["background"] == "synth:solid-dark"
    # Sample the frame border (cards never touch it): must be dark.
    assert image[:2].mean() < 70 and image[-2:].mean() < 70


def test_degrade_keeps_shape_and_changes_pixels():
    params = _small_params(blur_max=1.5)
    image, _ = synth.compose(_rng(2), params, synth.FakeCardPool(3))
    out = synth.degrade(image, _rng(9), params)
    assert out.shape == image.shape and out.dtype == np.uint8
    assert not np.array_equal(out, image)


def test_yolo_rows_normalised():
    cards = [
        {"quad": [[0, 0], [399, 0], [399, 299], [0, 299]]},
        {"quad": [[10, 20], [30, 20], [30, 60], [10, 60]]},
    ]
    rows = synth.yolo_rows(cards, 400, 300)
    assert len(rows) == 2
    for row in rows:
        parts = row.split()
        assert parts[0] == "0" and len(parts) == 9
        vals = [float(p) for p in parts[1:]]
        assert all(0.0 <= v <= 1.0 for v in vals)
    assert rows[0] == "0 0.000000 0.000000 1.000000 0.000000 1.000000 1.000000 0.000000 1.000000"


# --- dataset writing -----------------------------------------------------------------


def _read_all(directory: Path) -> dict[str, bytes]:
    return {p.name: p.read_bytes() for p in sorted(directory.rglob("*")) if p.is_file()}


def test_write_dataset_is_deterministic_and_matches_manifest(tmp_path):
    params = _small_params(export_yolo=True, max_overlap=0.15)
    a, b = tmp_path / "a", tmp_path / "b"
    entries = synth.write_dataset(a, 4, 123, params)
    synth.write_dataset(b, 4, 123, params)
    assert _read_all(a) == _read_all(b), "same seed must produce identical bytes"

    manifest = json.loads((a / "test-images.json").read_text())
    assert isinstance(manifest, list) and len(manifest) == 4
    assert manifest == entries
    for i, entry in enumerate(manifest, start=1):
        assert entry["fileName"] == f"synth_{i:05d}.jpg"
        img = cv2.imread(str(a / entry["fileName"]))
        assert img is not None
        h, w = img.shape[:2]
        for card in entry["cards"]:
            quad = np.array(card["quad"])
            assert (quad[:, 0] < w).all() and (quad[:, 1] < h).all()
        # YOLO export: one row per card, every value in [0, 1].
        rows = (a / "labels" / f"synth_{i:05d}.txt").read_text().strip().splitlines()
        assert len(rows) == len(entry["cards"])
        for row in rows:
            vals = [float(v) for v in row.split()[1:]]
            assert len(vals) == 8 and all(0.0 <= v <= 1.0 for v in vals)

    # A different seed gives different bytes (the RNG is actually used).
    c = tmp_path / "c"
    synth.write_dataset(c, 4, 124, params)
    assert _read_all(c) != _read_all(a)


def test_write_dataset_without_yolo_writes_no_labels(tmp_path):
    synth.write_dataset(tmp_path, 1, 1, _small_params())
    assert not (tmp_path / "labels").exists()
    assert (tmp_path / "test-images.json").exists()


def test_presets_are_valid():
    for name, params in synth.PRESETS.items():
        assert params.preset == name
        assert params.rotation_modes()  # parses without error
        for bg in params.backgrounds:
            assert bg in synth.BACKGROUND_KINDS or bg == "solid-dark"
    assert synth.PRESETS["regression"].cards == "fake"
    assert synth.PRESETS["regression"].long_edge == 2000
    assert synth.PRESETS["easy"].max_overlap == 0.0 and synth.PRESETS["easy"].glare == 0.0


def test_photo_backgrounds_from_directory(tmp_path):
    bg_dir = tmp_path / "bg"
    bg_dir.mkdir()
    cv2.imwrite(str(bg_dir / "table.jpg"), np.full((300, 500, 3), (30, 90, 160), np.uint8))
    params = _small_params(background_source="dir", background_dir=bg_dir, max_cards=1)
    image, entry = synth.compose(_rng(1), params, synth.FakeCardPool(2))
    assert entry["background"] == "synth:photo:table"
    assert image.shape[2] == 3
    # An empty directory is an error, not a silent fallback.
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(ValueError):
        synth.compose(_rng(1), synth.replace(params, background_dir=empty), synth.FakeCardPool(2))


def test_cli_regression_preset_defaults(tmp_path, monkeypatch):
    """The regression preset pins seed/n/cards unless explicitly overridden."""
    captured = {}

    def fake_write(out_dir, n, seed, params, *, pool=None, log=None):
        captured.update(out=out_dir, n=n, seed=seed, params=params)
        return []

    monkeypatch.setattr(synth, "write_dataset", fake_write)
    assert synth.main(["--out", str(tmp_path), "--preset", "regression"]) == 0
    assert captured["n"] == synth.REGRESSION_N
    assert captured["seed"] == synth.REGRESSION_SEED
    assert captured["params"].cards == "fake"
    assert captured["params"].long_edge == 2000

    assert (
        synth.main(
            [
                "--out",
                str(tmp_path),
                "--preset",
                "easy",
                "--n",
                "3",
                "--seed",
                "9",
                "--max-overlap",
                "0.2",
            ]
        )
        == 0
    )
    assert captured["n"] == 3 and captured["seed"] == 9
    assert captured["params"].max_overlap == 0.2 and captured["params"].preset == "easy"

"""
Synthetic test data: procedural fake cards and procedural backgrounds (and, built on
them, labelled composite "photos" — see the composite generator further down).

The fake cards are NOT Magic cards. They are card-shaped drawings — a black rounded
border, a coloured frame, a title bar with Hershey text, an "art" box of random
primitives, a text box and a bottom-left collector line — whose art is unique per
index, so pHash / ORB can tell them apart. They exist so unit tests and the synthetic
detection harness need no network access and no Wizards-owned images.

Everything is driven by an explicit ``numpy.random.Generator`` so datasets and tests
are reproducible from a seed.

CLI (run from ``card-scanner/backend``)::

    python -m app.synth --out ../data/synth --n 50 --preset hard
    python -m app.synth --preset regression --out ../data/synth-regression
    python -m app.synth --out DIR --cards cache --cache-limit 300 --backgrounds both:/photos
    python -m app.synth --out DIR --export-yolo --min-cards 1 --max-cards 8 --max-overlap 0.15

Presets: ``easy`` (paper/solid, upright or 90° turns, no overlap, no glare), ``medium``
(wood/fabric/gradient, small rotations, shadows), ``hard`` (noise/playmat/tiles/dark
solid, glare, overlap ≤ 0.15, blur), ``mixed`` (everything), ``regression`` (= mixed
with seed 20260912, 120 images, fake cards, 2000 px — the committed baseline set).
Output: ``synth_00001.jpg …`` plus one ``test-images.json`` manifest in the schema of
``test-images/test-images.json`` (quads in printed order, ``quadSource: verified``,
``background: synth:<kind>``), and ``labels/<stem>.txt`` YOLO polygons with
``--export-yolo``. Real cards need the image cache: ``python -m app.image_cache warm
--set CODE`` first.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, replace
from pathlib import Path

import cv2
import numpy as np

from . import config

# A card's border radius as a fraction of its width (real cards: ~3 mm of 63 mm).
CORNER_RADIUS_RATIO = 0.05

# Background kinds the procedural generator knows. Roughly ordered easy -> hard for
# the classical detector; the harness reports per kind.
BACKGROUND_KINDS = (
    "paper",  # white paper: today's happy path
    "solid",  # one flat colour (light or dark)
    "gradient",  # smooth two-colour ramp (uneven lighting)
    "noise",  # blurred low-frequency noise (felt / carpet)
    "wood",  # warped grain stripes (desk / table)
    "fabric",  # two orthogonal weaves (tablecloth)
    "playmat",  # busy: blobs + stripes + text-like rows (printed playmat)
    "tiles",  # grid lines (tiled table, cutting mat)
)

# Frame colours for fake cards (BGR), loosely the five Magic colours + artifact/land.
_FRAME_PALETTE = np.array(
    [
        (230, 230, 240),  # white-ish
        (200, 120, 40),  # blue
        (60, 50, 50),  # black
        (40, 40, 200),  # red
        (50, 140, 40),  # green
        (170, 170, 170),  # artifact grey
        (110, 130, 150),  # land tan
        (40, 170, 210),  # gold
    ],
    dtype=np.uint8,
)


def rounded_rect_mask(width: int, height: int, radius: int | None = None) -> np.ndarray:
    """A uint8 mask (255 inside) of a rectangle with rounded corners.

    Used both to round the fake card's corners and as the alpha channel when a card is
    composited onto a background (real cards are rounded, and the detector must cope).
    """
    radius = radius if radius is not None else max(1, round(width * CORNER_RADIUS_RATIO))
    mask = np.zeros((height, width), np.uint8)
    cv2.rectangle(mask, (radius, 0), (width - 1 - radius, height - 1), 255, -1)
    cv2.rectangle(mask, (0, radius), (width - 1, height - 1 - radius), 255, -1)
    for cx, cy in (
        (radius, radius),
        (width - 1 - radius, radius),
        (radius, height - 1 - radius),
        (width - 1 - radius, height - 1 - radius),
    ):
        cv2.circle(mask, (cx, cy), radius, 255, -1)
    return mask


def _put_text_fit(
    img: np.ndarray,
    text: str,
    org: tuple[int, int],
    max_width: int,
    scale: float,
    color,
    thickness: int = 1,
) -> None:
    """``cv2.putText`` with the scale reduced until ``text`` fits in ``max_width``."""
    font = cv2.FONT_HERSHEY_DUPLEX
    while scale > 0.2:
        (tw, _), _ = cv2.getTextSize(text, font, scale, thickness)
        if tw <= max_width:
            break
        scale *= 0.9
    cv2.putText(img, text, org, font, scale, color, thickness, cv2.LINE_AA)


def make_fake_card(
    rng: np.random.Generator, index: int, size: tuple[int, int] | None = None
) -> np.ndarray:
    """Render fake card number ``index`` as a portrait BGR image.

    The layout mimics a modern frame closely enough for the detector's priors (black
    border, bright title bar, dark art, light text box, tiny bottom text) while the art
    and colours are random, so different indices have distinct pHashes and features.
    Pixels outside the rounded corners are white (compositing uses
    :func:`rounded_rect_mask` as alpha).

    Args:
        rng: Generator that decides colours and art; the same ``rng`` state + ``index``
            reproduces the same card.
        index: Card number; printed in the title and the collector line.
        size: ``(width, height)``; defaults to the detector's output crop size.
    """
    w, h = size or (config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT)
    card = np.full((h, w, 3), 255, np.uint8)

    border = max(4, round(w * 0.045))
    frame_color = tuple(int(c) for c in _FRAME_PALETTE[rng.integers(len(_FRAME_PALETTE))])
    cv2.rectangle(card, (0, 0), (w - 1, h - 1), (10, 10, 10), -1)  # black border
    cv2.rectangle(card, (border, border), (w - 1 - border, h - 1 - border), frame_color, -1)

    inner = border + max(3, round(w * 0.03))
    # Title bar.
    title_h = round(h * 0.07)
    title_top = inner
    cv2.rectangle(
        card, (inner, title_top), (w - 1 - inner, title_top + title_h), (235, 235, 235), -1
    )
    _put_text_fit(
        card,
        f"Fake Card {index}",
        (inner + 8, title_top + title_h - round(title_h * 0.3)),
        w - 2 * inner - 60,
        0.9,
        (20, 20, 20),
        2,
    )
    cv2.circle(
        card, (w - inner - 18, title_top + title_h // 2), round(title_h * 0.32), (30, 30, 30), -1
    )  # "mana cost"

    # Art box: random primitives on a random base colour.
    art_top = title_top + title_h + 4
    art_bottom = round(h * 0.55)
    art = card[art_top:art_bottom, inner : w - inner]
    art[:] = rng.integers(0, 120, size=3, dtype=np.uint8)
    ah, aw = art.shape[:2]
    for _ in range(int(rng.integers(8, 20))):
        color = tuple(int(c) for c in rng.integers(0, 256, size=3))
        kind = rng.integers(4)
        if kind == 0:
            cv2.circle(
                art,
                (int(rng.integers(aw)), int(rng.integers(ah))),
                int(rng.integers(5, aw // 3)),
                color,
                -1,
            )
        elif kind == 1:
            cv2.line(
                art,
                (int(rng.integers(aw)), int(rng.integers(ah))),
                (int(rng.integers(aw)), int(rng.integers(ah))),
                color,
                int(rng.integers(1, 8)),
            )
        elif kind == 2:
            pts = rng.integers([0, 0], [aw, ah], size=(int(rng.integers(3, 7)), 2)).astype(np.int32)
            cv2.fillPoly(art, [pts], color)
        else:
            cv2.ellipse(
                art,
                (int(rng.integers(aw)), int(rng.integers(ah))),
                (int(rng.integers(5, aw // 3)), int(rng.integers(5, ah // 3))),
                float(rng.uniform(0, 180)),
                0,
                360,
                color,
                -1,
            )

    # Type bar + text box with "rules text" lines.
    type_top = art_bottom + 4
    type_h = round(h * 0.055)
    cv2.rectangle(card, (inner, type_top), (w - 1 - inner, type_top + type_h), (235, 235, 235), -1)
    _put_text_fit(
        card,
        "Creature - Synthetic",
        (inner + 8, type_top + type_h - round(type_h * 0.3)),
        w - 2 * inner - 16,
        0.7,
        (20, 20, 20),
        1,
    )
    text_top = type_top + type_h + 4
    text_bottom = h - inner - round(h * 0.06)
    cv2.rectangle(card, (inner, text_top), (w - 1 - inner, text_bottom), (245, 245, 240), -1)
    line_h = round(h * 0.035)
    y = text_top + line_h
    words = [
        "When",
        "this",
        "card",
        "enters",
        "draw",
        "a",
        "card",
        "then",
        "discard",
        "one",
        "at",
        "random",
        "target",
        "player",
    ]
    while y < text_bottom - 4:
        n = int(rng.integers(4, 9))
        line = " ".join(words[int(rng.integers(len(words)))] for _ in range(n))
        _put_text_fit(card, line, (inner + 8, y), w - 2 * inner - 16, 0.55, (30, 30, 30), 1)
        y += line_h

    # Bottom strip: collector line in small light text on the black border, like a
    # modern card ("NNN/500 C FAK • EN").
    _put_text_fit(
        card,
        f"{index:03d}/500 C  FAK - EN",
        (border + 4, h - border // 2 - 2 + 6),
        w // 2,
        0.42,
        (210, 210, 210),
        1,
    )

    # Round the corners (white outside, to be masked by rounded_rect_mask when composited).
    mask = rounded_rect_mask(w, h)
    card[mask == 0] = 255
    return card


def procedural_background(
    rng: np.random.Generator, width: int, height: int, kind: str
) -> np.ndarray:
    """Generate a ``height x width`` BGR background of the given kind.

    Kinds are listed in :data:`BACKGROUND_KINDS`; each models a surface people put
    cards on. All are deliberately imperfect (noise, uneven light) so that a detector
    tuned on them does not overfit to flat colour.
    """
    if kind not in BACKGROUND_KINDS:
        raise ValueError(f"unknown background kind {kind!r}; known: {BACKGROUND_KINDS}")

    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)

    def _noise(scale: int, amplitude: float) -> np.ndarray:
        """Smooth noise: random low-res field upscaled to the canvas."""
        small = rng.random((max(2, height // scale), max(2, width // scale)), dtype=np.float32)
        return cv2.resize(small, (width, height), interpolation=cv2.INTER_CUBIC) * amplitude

    if kind == "paper":
        base = (
            np.full((height, width), 235.0, np.float32)
            + _noise(8, 12)
            + rng.normal(0, 2, (height, width)).astype(np.float32)
        )
        img = np.dstack([base, base, base + 3])
    elif kind == "solid":
        color = rng.integers(0, 256, 3) if rng.random() < 0.5 else rng.integers(0, 80, 3)
        img = np.empty((height, width, 3), np.float32)
        img[:] = color
        img += rng.normal(0, 3, img.shape).astype(np.float32)
    elif kind == "gradient":
        c0, c1 = (
            rng.integers(0, 256, 3).astype(np.float32),
            rng.integers(0, 256, 3).astype(np.float32),
        )
        angle = rng.uniform(0, np.pi)
        t = np.cos(angle) * xx / width + np.sin(angle) * yy / height
        t = (t - t.min()) / (t.max() - t.min() + 1e-6)
        img = c0 * (1 - t)[..., None] + c1 * t[..., None]
    elif kind == "noise":
        base = rng.integers(20, 200, 3).astype(np.float32)
        img = np.empty((height, width, 3), np.float32)
        img[:] = base
        img += _noise(24, 40)[..., None] + _noise(6, 15)[..., None]
    elif kind == "wood":
        light = rng.random() < 0.5
        base = np.array((60, 110, 170) if light else (20, 40, 70), np.float32)  # BGR browns
        warp = _noise(40, 30)
        period = float(rng.uniform(6, 18))
        grain = np.sin((yy + warp) / period * 2 * np.pi) * 0.5 + 0.5  # stripes along x, wavy
        img = np.empty((height, width, 3), np.float32)
        img[:] = base
        img += (grain * float(rng.uniform(10, 30)))[..., None] + _noise(4, 6)[..., None]
    elif kind == "fabric":
        base = rng.integers(20, 180, 3).astype(np.float32)
        p1, p2 = float(rng.uniform(4, 9)), float(rng.uniform(4, 9))
        weave = (np.sin(xx / p1 * 2 * np.pi) * np.sin(yy / p2 * 2 * np.pi)) * float(
            rng.uniform(8, 20)
        )
        img = np.empty((height, width, 3), np.float32)
        img[:] = base
        img += weave[..., None] + _noise(3, 8)[..., None] + _noise(60, 25)[..., None]
    elif kind == "playmat":
        img = np.empty((height, width, 3), np.float32)
        img[:] = rng.integers(0, 120, 3)
        canvas = img.astype(np.uint8)
        for _ in range(int(rng.integers(6, 16))):  # blobs
            cv2.circle(
                canvas,
                (int(rng.integers(width)), int(rng.integers(height))),
                int(rng.integers(20, max(21, width // 4))),
                tuple(int(c) for c in rng.integers(0, 256, 3)),
                -1,
            )
        for _ in range(int(rng.integers(3, 8))):  # long straight stripes (distractor lines)
            cv2.line(
                canvas,
                (int(rng.integers(width)), int(rng.integers(height))),
                (int(rng.integers(width)), int(rng.integers(height))),
                tuple(int(c) for c in rng.integers(0, 256, 3)),
                int(rng.integers(2, 12)),
            )
        for _ in range(int(rng.integers(2, 6))):  # text-like rows
            y0 = int(rng.integers(height))
            cv2.putText(
                canvas,
                "LOREM IPSUM DOLOR SIT AMET",
                (int(rng.integers(width)), y0),
                cv2.FONT_HERSHEY_SIMPLEX,
                float(rng.uniform(0.6, 2.0)),
                tuple(int(c) for c in rng.integers(0, 256, 3)),
                2,
                cv2.LINE_AA,
            )
        canvas = cv2.GaussianBlur(canvas, (0, 0), 1.2)
        img = canvas.astype(np.float32) + _noise(5, 6)[..., None]
    else:  # tiles
        base = rng.integers(60, 220, 3).astype(np.float32)
        img = np.empty((height, width, 3), np.float32)
        img[:] = base
        img += _noise(10, 8)[..., None]
        pitch = int(rng.integers(40, 160))
        canvas = np.clip(img, 0, 255).astype(np.uint8)
        line_color = tuple(int(c) for c in np.clip(base - 60, 0, 255))
        for x in range(int(rng.integers(pitch)), width, pitch):
            cv2.line(canvas, (x, 0), (x, height - 1), line_color, 2)
        for y in range(int(rng.integers(pitch)), height, pitch):
            cv2.line(canvas, (0, y), (width - 1, y), line_color, 2)
        img = canvas.astype(np.float32)

    return np.clip(img, 0, 255).astype(np.uint8)


# ============================================================================
# Composite generator: labelled synthetic "photos"
# ============================================================================
#
# A composite is a background (procedural, or a random crop of a user photo) with
# 1–8 cards warped onto it under a random similarity + perspective jitter, with a
# drop shadow and optional glare, then degraded like a phone photo (colour
# temperature, gamma, noise, blur, vignette, JPEG). Because every card is placed by
# a known homography, its four corners are known exactly — the dataset comes with
# ground-truth quads in *printed* order for free, which is what the detection
# harness (`app.evaluate_photos`) and a future learned detector (`--export-yolo`)
# consume. Cards are either the procedural fakes above (no network, no Wizards
# images) or real Scryfall images from the on-disk cache (`--cards cache`).
#
# The manifest written by `write_dataset` uses exactly the schema of the user's
# hand-authored `test-images/test-images.json`, so a synth output directory is a
# drop-in dataset for the harness.

# Rotation modes understood by `place_card`; a "|"-joined list picks one per card.
ROTATION_MODES = ("upright", "any90", "small", "any")

# The fake "set" printed on procedural cards (also their manifest set code).
FAKE_SET_CODE = "FAK"

# Real-photo canvases are 4:3 (phone cameras); we keep that aspect and pick
# landscape or portrait per composite.
_CANVAS_ASPECT = 4.0 / 3.0


@dataclass
class SynthParams:
    """Every knob of the composite generator (see the CLI for the same names).

    Kept as a plain dataclass so presets are just instances and tests can tweak one
    field at a time. ``backgrounds`` entries are :data:`BACKGROUND_KINDS` names, or
    ``"solid-dark"`` (a ``solid`` forced dark — the case where a black card border
    has no luminance edge). ``rotation_mode`` is one of :data:`ROTATION_MODES` or
    several joined with ``|`` (one is drawn per card).
    """

    long_edge: int = 2000
    min_cards: int = 1
    max_cards: int = 6
    max_overlap: float = 0.0  # max IoU between any two card quads (0 = no overlap)
    overlap_prob: float = 0.5  # chance a composite allows overlap at all (else 0 IoU)
    scale_range: tuple[float, float] = (0.12, 0.6)  # card long edge / canvas long edge
    rotation_mode: str = "any"
    perspective_jitter: float = 0.08  # per-corner jitter as a fraction of the card long edge
    shadow: bool = True
    glare: float = 0.2  # probability that a card gets a glare highlight
    backgrounds: tuple[str, ...] = BACKGROUND_KINDS
    background_dir: Path | None = None  # user photos; None = procedural only
    background_source: str = "procedural"  # procedural | dir | both
    blur_max: float = 1.5  # max Gaussian blur sigma (px) applied in `degrade`
    degrade: bool = True
    cards: str = "fake"  # fake | cache
    cache_limit: int | None = None  # how many cached faces to sample from (None = all)
    fake_pool: int = 200  # how many distinct fake cards the fake pool renders
    export_yolo: bool = False
    preset: str = "custom"  # recorded in the manifest tags

    def rotation_modes(self) -> tuple[str, ...]:
        modes = tuple(m.strip() for m in self.rotation_mode.split("|") if m.strip())
        for m in modes:
            if m not in ROTATION_MODES:
                raise ValueError(f"unknown rotation mode {m!r}; known: {ROTATION_MODES}")
        return modes


# Presets, roughly ordered by how hard they are for the classical detector. The
# regression preset is `mixed` with a fixed seed/size so a committed baseline
# (benchmarks/synth-regression.detection.json) can be compared across changes.
PRESETS: dict[str, SynthParams] = {
    "easy": SynthParams(
        backgrounds=("paper", "solid"),
        rotation_mode="upright|any90",
        max_overlap=0.0,
        shadow=False,
        glare=0.0,
        blur_max=0.4,
        perspective_jitter=0.03,
        preset="easy",
    ),
    "medium": SynthParams(
        backgrounds=("wood", "fabric", "gradient"),
        rotation_mode="small",
        max_overlap=0.0,
        shadow=True,
        glare=0.0,
        blur_max=0.8,
        preset="medium",
    ),
    "hard": SynthParams(
        backgrounds=("noise", "playmat", "tiles", "solid-dark"),
        rotation_mode="any",
        max_overlap=0.15,
        overlap_prob=0.6,
        shadow=True,
        glare=0.35,
        blur_max=1.5,
        preset="hard",
    ),
    "mixed": SynthParams(
        backgrounds=BACKGROUND_KINDS + ("solid-dark",),
        rotation_mode="upright|any90|small|any",
        max_overlap=0.15,
        overlap_prob=0.4,
        shadow=True,
        glare=0.2,
        blur_max=1.5,
        preset="mixed",
    ),
}
PRESETS["regression"] = replace(PRESETS["mixed"], preset="regression", cards="fake", long_edge=2000)

# Fixed seed / size of the regression preset (CLI defaults when --preset regression).
REGRESSION_SEED = 20260912
REGRESSION_N = 120


# --- Quad geometry (private; app.geometry is the shared module for the pipeline,
# but the generator must not depend on it so it stays usable standalone) --------


def _quad_area(quad: np.ndarray) -> float:
    """Shoelace area of a 4-point polygon (absolute value)."""
    x, y = quad[:, 0], quad[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) * 0.5)


def _is_convex(quad: np.ndarray) -> bool:
    """True when all four turns of the polygon have the same sign (strictly convex)."""
    signs = []
    for i in range(4):
        a, b, c = quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        signs.append(np.sign(cross))
    return all(s != 0 for s in signs) and len(set(signs)) == 1


def _intersection_area(a: np.ndarray, b: np.ndarray) -> float:
    """Area of the intersection of two convex quads (0 when disjoint)."""
    area, _ = cv2.intersectConvexConvex(a.astype(np.float32), b.astype(np.float32))
    return float(area)


def _quad_iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = _intersection_area(a, b)
    if inter <= 0:
        return 0.0
    return inter / (_quad_area(a) + _quad_area(b) - inter)


# --- Placement --------------------------------------------------------------


def _rotation_for(mode: str, rng: np.random.Generator) -> float:
    """Draw a rotation (degrees, clockwise in image coords) for one mode."""
    if mode == "upright":
        return float(rng.uniform(-2, 2))  # nobody lays a card down perfectly square
    if mode == "any90":
        return float(rng.integers(4) * 90 + rng.uniform(-2, 2))
    if mode == "small":
        return float(rng.uniform(-15, 15))
    return float(rng.uniform(0, 360))


def sample_placement(
    canvas_shape: tuple[int, ...],
    card_shape: tuple[int, ...],
    rng: np.random.Generator,
    *,
    scale_range: tuple[float, float] = (0.12, 0.6),
    rotation_mode: str = "any",
    perspective_jitter: float = 0.08,
    margin: int = 4,
) -> np.ndarray:
    """Draw a destination quad for a card, fully inside the canvas.

    The card's long edge becomes ``scale × canvas long edge``; the rectangle is
    rotated per ``rotation_mode`` (see :data:`ROTATION_MODES`), each corner is
    jittered by up to ``perspective_jitter × card long edge`` (a mild off-axis view),
    and the result is shrunk about its centroid if it would not fit, then translated
    to a uniformly random position that keeps it ``margin`` px inside the frame.

    Returns ``float32 (4, 2)`` in printed order: the images of the card's own
    corners ``(0,0), (w,0), (w,h), (0,h)`` — top-left, top-right, bottom-right,
    bottom-left *of the printed card*, whatever the rotation. Always convex.
    """
    ch, cw = canvas_shape[:2]
    h, w = card_shape[:2]
    modes = tuple(m.strip() for m in rotation_mode.split("|") if m.strip())
    mode = modes[int(rng.integers(len(modes)))] if len(modes) > 1 else modes[0]
    if mode not in ROTATION_MODES:
        raise ValueError(f"unknown rotation mode {mode!r}; known: {ROTATION_MODES}")

    canvas_long = max(cw, ch)
    long_edge = float(rng.uniform(*scale_range)) * canvas_long
    s = long_edge / max(w, h)
    # Card rectangle centred at the origin, in printed order.
    rect = np.array(
        [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], np.float32
    ) * np.float32(s)

    for _attempt in range(20):
        theta = np.deg2rad(_rotation_for(mode, rng))
        rot = np.array(
            [[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]], np.float32
        )
        quad = rect @ rot.T
        # Independent per-corner jitter = a random mild perspective. Bounded by the
        # scaled long edge so the quad stays convex and card-like.
        quad += rng.uniform(-1, 1, size=(4, 2)).astype(np.float32) * np.float32(
            perspective_jitter * long_edge
        )
        # Shrink about the centroid until the bounding box fits in the frame.
        bw, bh = np.ptp(quad[:, 0]), np.ptp(quad[:, 1])
        fit = min((cw - 2 * margin) / max(bw, 1e-6), (ch - 2 * margin) / max(bh, 1e-6))
        if fit < 1:
            quad *= np.float32(fit * 0.98)
        if not _is_convex(quad):
            continue
        x0, y0 = quad.min(axis=0)
        x1, y1 = quad.max(axis=0)
        tx = rng.uniform(margin - x0, cw - margin - x1)
        ty = rng.uniform(margin - y0, ch - margin - y1)
        return (quad + np.float32([tx, ty])).astype(np.float32)

    # Extremely unlikely (jitter ≤ 8 % keeps rectangles convex); fall back to the
    # un-jittered rectangle so callers always get a valid quad.
    quad = rect.copy()
    quad -= quad.min(axis=0) - margin
    return quad.astype(np.float32)


def render_card(
    canvas: np.ndarray,
    card_bgr: np.ndarray,
    quad: np.ndarray,
    rng: np.random.Generator,
    *,
    shadow: bool = True,
    glare: float = 0.2,
) -> dict:
    """Composite ``card_bgr`` onto ``canvas`` (in place) so its corners land on ``quad``.

    Steps, all inside one padded ROI around the quad (never the whole canvas):

    1. The card is downscaled with ``INTER_AREA`` to roughly its on-canvas size
       first, so the perspective warp does not alias fine text.
    2. Card *and* :func:`rounded_rect_mask` are warped by the same homography; the
       warped mask is the alpha, so rounded corners survive the warp and the
       background shows through them (exactly what the detector sees in a photo).
    3. Drop shadow (``shadow``): the alpha, offset and blurred, darkens the background
       — cards cast a soft shadow on a table under room light.
    4. Glare (with probability ``glare``): an additive blurred ellipse inside the card
       — a sleeve/foil reflection, the classic pHash/OCR killer.

    Returns ``{"glare": bool, "scale": float}`` for the manifest tags.
    """
    ch, cw = canvas.shape[:2]
    h, w = card_bgr.shape[:2]
    quad = np.asarray(quad, np.float32)
    long_edge = float(max(np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[3] - quad[0])))

    # 1. Pre-shrink so the warp samples a card of about the right resolution.
    s = min(1.0, long_edge / max(w, h))
    if s < 1.0:
        card_bgr = cv2.resize(
            card_bgr, (max(2, round(w * s)), max(2, round(h * s))), interpolation=cv2.INTER_AREA
        )
        h, w = card_bgr.shape[:2]
    alpha_src = rounded_rect_mask(w, h)

    # Padded ROI: shadow offset + blur reach must fit inside it.
    shadow_sigma = 0.015 * long_edge
    shadow_dx = float(rng.uniform(0.005, 0.03) * long_edge) if shadow else 0.0
    shadow_dy = float(rng.uniform(0.01, 0.04) * long_edge) if shadow else 0.0
    pad = int(3 * shadow_sigma + max(shadow_dx, shadow_dy)) + 4
    x0 = max(0, int(np.floor(quad[:, 0].min())) - pad)
    y0 = max(0, int(np.floor(quad[:, 1].min())) - pad)
    x1 = min(cw, int(np.ceil(quad[:, 0].max())) + pad)
    y1 = min(ch, int(np.ceil(quad[:, 1].max())) + pad)
    rw, rh = x1 - x0, y1 - y0
    if rw <= 1 or rh <= 1:
        return {"glare": False, "scale": s}

    # 2. Homography from the (resized) card to the quad, shifted into ROI coords.
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = quad - np.float32([x0, y0])
    H = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(card_bgr, H, (rw, rh), flags=cv2.INTER_LINEAR)
    alpha = cv2.warpPerspective(alpha_src, H, (rw, rh), flags=cv2.INTER_LINEAR)
    alpha = alpha.astype(np.float32) / 255.0

    roi = canvas[y0:y1, x0:x1].astype(np.float32)

    # 3. Shadow: the alpha shifted down-right and blurred, scaled by a strength that
    #    varies per card (lighting differs across a table).
    if shadow:
        shift = np.float32([[1, 0, shadow_dx], [0, 1, shadow_dy]])
        sh = cv2.warpAffine(alpha, shift, (rw, rh))
        sh = cv2.GaussianBlur(sh, (0, 0), max(shadow_sigma, 0.5))
        strength = float(rng.uniform(0.3, 0.6))
        roi *= 1.0 - (strength * sh)[..., None]

    # 4. Glare: bright ellipse, blurred, added inside the card only.
    glared = False
    if glare > 0 and rng.random() < glare:
        glared = True
        layer = np.zeros((rh, rw), np.float32)
        u, v = rng.uniform(0.15, 0.85, size=2)
        # Bilinear point inside the quad (in ROI coords) so the highlight sits on
        # the card rather than merely in its bounding box.
        p = (
            (1 - u) * (1 - v) * dst[0]
            + u * (1 - v) * dst[1]
            + u * v * dst[2]
            + (1 - u) * v * dst[3]
        )
        axes = (
            int(max(2, rng.uniform(0.08, 0.3) * long_edge)),
            int(max(2, rng.uniform(0.05, 0.2) * long_edge)),
        )
        cv2.ellipse(
            layer, (int(p[0]), int(p[1])), axes, float(rng.uniform(0, 180)), 0, 360, 1.0, -1
        )
        layer = cv2.GaussianBlur(layer, (0, 0), max(0.06 * long_edge, 1.0))
        intensity = float(rng.uniform(70, 150))
        warped = np.clip(warped.astype(np.float32) + (layer * intensity)[..., None], 0, 255)

    # Alpha composite.
    a3 = alpha[..., None]
    roi = roi * (1.0 - a3) + warped.astype(np.float32) * a3
    canvas[y0:y1, x0:x1] = np.clip(roi, 0, 255).astype(np.uint8)
    return {"glare": glared, "scale": s}


def place_card(
    canvas: np.ndarray,
    card_bgr: np.ndarray,
    rng: np.random.Generator,
    *,
    scale_range: tuple[float, float] = (0.12, 0.6),
    rotation_mode: str = "any",
    perspective_jitter: float = 0.08,
    shadow: bool = True,
    glare: float = 0.2,
) -> np.ndarray:
    """Sample a placement and draw the card onto ``canvas`` (in place).

    Convenience wrapper over :func:`sample_placement` + :func:`render_card`; returns
    the card's corners in canvas coordinates, **printed order TL, TR, BR, BL**.
    """
    quad = sample_placement(
        canvas.shape,
        card_bgr.shape,
        rng,
        scale_range=scale_range,
        rotation_mode=rotation_mode,
        perspective_jitter=perspective_jitter,
    )
    render_card(canvas, card_bgr, quad, rng, shadow=shadow, glare=glare)
    return quad


# --- Card sources -----------------------------------------------------------


@dataclass
class CardAsset:
    """One card image plus the identity written to the manifest."""

    name: str
    set_code: str
    number: str
    scryfall_id: str | None
    image: np.ndarray


class FakeCardPool:
    """Procedural cards, rendered lazily and memoised by index.

    Card ``i`` is always rendered from ``default_rng(seed + i)``, so the same index
    yields the same image no matter in which order cards are drawn — datasets stay
    reproducible even when the placement RNG changes how many cards are needed.
    """

    def __init__(self, size: int = 200, seed: int = 0) -> None:
        self.size = max(1, size)
        self.seed = seed
        self._cache: dict[int, np.ndarray] = {}

    def draw(self, rng: np.random.Generator) -> CardAsset:
        i = int(rng.integers(self.size)) + 1
        if i not in self._cache:
            self._cache[i] = make_fake_card(np.random.default_rng(self.seed + i), i)
        return CardAsset(f"Fake Card {i}", FAKE_SET_CODE, str(i), None, self._cache[i])


class CachedCardPool:
    """Real Scryfall images from the on-disk image cache (``--cards cache``).

    Identity (name / set / number) comes from the index database when reachable;
    otherwise the manifest falls back to the Scryfall id as the name with a blank
    set — still resolvable by the harness through ``scryfallId``.
    """

    def __init__(self, limit: int | None = None, *, rng: np.random.Generator | None = None) -> None:
        from . import image_cache  # local: keeps `import app.synth` free of cache config

        faces = list(image_cache.iter_cached())
        if not faces:
            raise RuntimeError(
                "image cache is empty or disabled — run `python -m app.image_cache warm "
                "--set CODE` first, or use --cards fake"
            )
        if limit is not None and limit < len(faces):
            order = rng.permutation(len(faces)) if rng is not None else np.arange(limit)
            faces = [faces[int(i)] for i in order[:limit]]
        self.faces = faces
        self.meta = self._load_metadata({sid for sid, _face, _path in faces})
        self._cache: dict[int, np.ndarray] = {}

    @staticmethod
    def _load_metadata(sids: set[str]) -> dict[tuple[str, str], tuple[str, str, str]]:
        """``(scryfall_id, face) -> (name, set, number)`` from the index, if reachable."""
        try:
            from . import index_db

            try:
                with index_db.connection() as conn:
                    rows = conn.execute(
                        "SELECT scryfall_id, face, name, set_code, collector_number FROM cards "
                        "WHERE scryfall_id = ANY(%s)",
                        (sorted(sids),),
                    ).fetchall()
            finally:
                # One-shot lookup: release the pool now rather than at interpreter
                # shutdown (where psycopg_pool's finaliser cannot join its threads).
                index_db.close_pool()
        except Exception as err:  # no DB: the manifest keeps scryfallId only
            print(f"warning: index not reachable ({err}); manifest names fall back to ids")
            return {}
        return {
            (r["scryfall_id"], r["face"]): (
                r["name"],
                (r["set_code"] or "").upper(),
                r["collector_number"] or "",
            )
            for r in rows
        }

    def draw(self, rng: np.random.Generator) -> CardAsset:
        i = int(rng.integers(len(self.faces)))
        sid, face, path = self.faces[i]
        if i not in self._cache:
            image = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if image is None:
                raise RuntimeError(f"cached image is unreadable: {path}")
            self._cache[i] = image
        name, set_code, number = self.meta.get((sid, face), (sid, "", ""))
        return CardAsset(name, set_code, number, sid, self._cache[i])


# --- Backgrounds ------------------------------------------------------------

_BACKGROUND_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def _list_background_photos(directory: Path) -> list[Path]:
    return sorted(p for p in Path(directory).iterdir() if p.suffix.lower() in _BACKGROUND_EXTS)


def _photo_background(
    rng: np.random.Generator, width: int, height: int, photos: list[Path]
) -> tuple[np.ndarray, str]:
    """A random crop of a user background photo, resized and colour-jittered.

    The crop keeps the canvas aspect and covers 50–100 % of the photo's shorter
    side, so one photo of a table yields many different framings; brightness and
    hue jitter plus a random flip stop a detector from memorising the photo.
    """
    path = photos[int(rng.integers(len(photos)))]
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f"unreadable background photo: {path}")
    ih, iw = img.shape[:2]
    aspect = width / height
    frac = float(rng.uniform(0.5, 1.0))
    if iw / ih > aspect:  # photo wider than the canvas: height limits the crop
        crop_h = int(ih * frac)
        crop_w = int(min(iw, crop_h * aspect))
    else:
        crop_w = int(iw * frac)
        crop_h = int(min(ih, crop_w / aspect))
    x = int(rng.integers(0, iw - crop_w + 1))
    y = int(rng.integers(0, ih - crop_h + 1))
    crop = img[y : y + crop_h, x : x + crop_w]
    if rng.random() < 0.5:
        crop = cv2.flip(crop, 1)
    out = cv2.resize(crop, (width, height), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 0] = (hsv[..., 0] + rng.uniform(-8, 8)) % 180
    hsv[..., 1] *= rng.uniform(0.8, 1.2)
    hsv[..., 2] *= rng.uniform(0.7, 1.2)
    out = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR)
    return out, f"photo:{path.stem}"


def make_background(
    rng: np.random.Generator, width: int, height: int, params: SynthParams
) -> tuple[np.ndarray, str]:
    """Pick and generate a background per ``params``; returns ``(image, label)``.

    The label goes into the manifest as ``background: "synth:<label>"`` so the
    harness can break results down per surface kind.
    """
    photos: list[Path] = []
    if params.background_source in ("dir", "both"):
        if params.background_dir is None:
            raise ValueError("background_source needs background_dir")
        photos = _list_background_photos(params.background_dir)
        if not photos:
            raise ValueError(f"no background photos in {params.background_dir}")
    use_photo = bool(photos) and (params.background_source == "dir" or rng.random() < 0.5)
    if use_photo:
        return _photo_background(rng, width, height, photos)

    spec = params.backgrounds[int(rng.integers(len(params.backgrounds)))]
    if spec == "solid-dark":
        img = procedural_background(rng, width, height, "solid")
        # Force a dark surface: scale the whole image into the 5–60 range.
        img = np.clip(img.astype(np.float32) * 0.25 + rng.uniform(0, 10), 0, 60).astype(np.uint8)
        return img, spec
    return procedural_background(rng, width, height, spec), spec


# --- Composition ------------------------------------------------------------


def compose(rng: np.random.Generator, params: SynthParams, pool=None) -> tuple[np.ndarray, dict]:
    """Render one composite and its manifest entry (``fileName`` left empty).

    Cards are placed one after another; a placement whose IoU with any existing
    card exceeds the overlap limit is re-drawn (up to 40 tries, after which the
    composite simply has fewer cards). The limit is ``params.max_overlap`` for a
    ``params.overlap_prob`` fraction of composites and 0 for the rest — most real
    photos have cards laid out side by side, so overlap should be the exception
    rather than something every multi-card image exhibits. A later card is drawn
    on top of earlier ones, so any earlier card it touches at all is marked
    ``occluded``. Every quad is fully inside the frame and convex by construction.

    ``pool`` supplies card images (default :class:`FakeCardPool`); it is a parameter
    so callers can reuse one pool (and its rendered/loaded images) across a dataset.
    """
    if pool is None:
        pool = FakeCardPool(params.fake_pool)
    long_edge = int(params.long_edge)
    short_edge = int(round(long_edge / _CANVAS_ASPECT))
    landscape = rng.random() < 0.6
    width, height = (long_edge, short_edge) if landscape else (short_edge, long_edge)

    canvas, bg_label = make_background(rng, width, height, params)
    n_target = int(rng.integers(params.min_cards, params.max_cards + 1))
    max_overlap = params.max_overlap if rng.random() < params.overlap_prob else 0.0

    quads: list[np.ndarray] = []
    cards: list[dict] = []
    tags: set[str] = set()
    for _ in range(n_target):
        asset = pool.draw(rng)
        quad = None
        for _try in range(40):
            candidate = sample_placement(
                canvas.shape,
                asset.image.shape,
                rng,
                scale_range=params.scale_range,
                rotation_mode=params.rotation_mode,
                perspective_jitter=params.perspective_jitter,
            )
            if all(_quad_iou(candidate, q) <= max_overlap for q in quads):
                quad = candidate
                break
        if quad is None:
            continue
        info = render_card(canvas, asset.image, quad, rng, shadow=params.shadow, glare=params.glare)
        for j, other in enumerate(quads):
            if _intersection_area(quad, other) > 0:
                cards[j]["occluded"] = True
                tags.add("overlap")
        if info["glare"]:
            tags.add("glare")
        quads.append(quad)
        # Round to ints and clamp: a corner may sit at e.g. 3.6 px, and the manifest
        # stores integer pixels (the frame is [0, W-1] x [0, H-1]).
        pts = np.rint(quad).astype(int)
        pts[:, 0] = np.clip(pts[:, 0], 0, width - 1)
        pts[:, 1] = np.clip(pts[:, 1], 0, height - 1)
        cards.append(
            {
                "name": asset.name,
                "set": asset.set_code,
                "number": asset.number,
                "quad": pts.tolist(),
                "quadSource": "verified",
                "occluded": False,
                # Omitted (not null) for fake cards: the manifest validator only accepts strings.
                **({"scryfallId": asset.scryfall_id} if asset.scryfall_id else {}),
            }
        )

    tags.update({"synthetic", f"preset:{params.preset}", f"cards:{len(cards)}"})
    entry = {
        "fileName": "",
        "description": (
            f"Synthetic composite: {len(cards)} {'fake' if params.cards == 'fake' else 'real'} "
            f"card(s) on a {bg_label} background ({width}x{height}, preset {params.preset})."
        ),
        "kind": "photo",
        "background": f"synth:{bg_label}",
        "tags": sorted(tags),
        "cards": cards,
    }
    return canvas, entry


def degrade(img: np.ndarray, rng: np.random.Generator, params: SynthParams) -> np.ndarray:
    """Phone-photo degradation; geometry is untouched so quads stay exact.

    Colour temperature (warm lamp / cool daylight), gamma (exposure), Gaussian
    sensor noise, optional blur up to ``params.blur_max`` px (focus / motion),
    vignette (lens fall-off) and a JPEG round trip at quality 70–92. Order matters:
    noise is added before blur and JPEG so it is filtered the way a camera pipeline
    would filter it.
    """
    out = img.astype(np.float32)
    h, w = out.shape[:2]

    # Colour temperature: push blue and red in opposite directions.
    temp = float(rng.uniform(-0.08, 0.08))
    out[..., 0] *= 1.0 - temp  # B
    out[..., 2] *= 1.0 + temp  # R
    # Gamma (exposure): <1 brightens, >1 darkens.
    gamma = float(rng.uniform(0.8, 1.25))
    out = 255.0 * np.power(np.clip(out, 0, 255) / 255.0, gamma)
    # Sensor noise.
    out += rng.normal(0, float(rng.uniform(1.0, 6.0)), out.shape).astype(np.float32)
    # Blur.
    sigma = float(rng.uniform(0, params.blur_max))
    if sigma > 0.2:
        out = cv2.GaussianBlur(out, (0, 0), sigma)
    # Vignette: radial fall-off, up to 30 % darker at the corners.
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
    out *= (1.0 - float(rng.uniform(0.0, 0.3)) * r**2)[..., None]
    out8 = np.clip(out, 0, 255).astype(np.uint8)
    # JPEG round trip at typical phone quality.
    ok, enc = cv2.imencode(".jpg", out8, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(70, 93))])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR) if ok else out8


def yolo_rows(cards: list[dict], width: int, height: int) -> list[str]:
    """YOLO polygon label lines (``0 x1 y1 … x4 y4``, normalised to [0, 1])."""
    rows = []
    for card in cards:
        coords = []
        for x, y in card["quad"]:
            coords.append(min(1.0, max(0.0, x / max(width - 1, 1))))
            coords.append(min(1.0, max(0.0, y / max(height - 1, 1))))
        rows.append("0 " + " ".join(f"{c:.6f}" for c in coords))
    return rows


def write_dataset(
    out_dir: Path | str,
    n: int,
    seed: int,
    params: SynthParams,
    *,
    pool=None,
    log=None,
) -> list[dict]:
    """Write ``n`` composites plus one manifest ``<out_dir>/test-images.json``.

    Images are ``synth_00001.jpg`` … (JPEG q92 — after :func:`degrade` has already
    applied its own lower-quality round trip). The manifest is a JSON array of
    entries in the user's ``test-images.json`` schema, so the directory is a
    harness dataset as-is. With ``params.export_yolo`` a ``labels/<stem>.txt`` is
    written per image. Everything derives from ``seed`` → identical bytes on re-run.
    Returns the manifest entries.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    labels_dir = out_dir / "labels"
    if params.export_yolo:
        labels_dir.mkdir(exist_ok=True)
    rng = np.random.default_rng(seed)
    if pool is None:
        if params.cards == "cache":
            pool = CachedCardPool(params.cache_limit, rng=rng)
        else:
            pool = FakeCardPool(params.fake_pool, seed=seed)

    entries: list[dict] = []
    for i in range(1, n + 1):
        image, entry = compose(rng, params, pool)
        if params.degrade:
            image = degrade(image, rng, params)
        stem = f"synth_{i:05d}"
        entry["fileName"] = f"{stem}.jpg"
        entry["description"] += f" seed={seed} #{i}"
        ok, enc = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            raise RuntimeError(f"could not encode {stem}")
        (out_dir / entry["fileName"]).write_bytes(enc.tobytes())
        if params.export_yolo:
            h, w = image.shape[:2]
            (labels_dir / f"{stem}.txt").write_text(
                "\n".join(yolo_rows(entry["cards"], w, h)) + "\n"
            )
        entries.append(entry)
        if log and (i % 10 == 0 or i == n):
            log(f"  {i}/{n}")

    with open(out_dir / "test-images.json", "w") as fh:
        json.dump(entries, fh, indent=2)
        fh.write("\n")
    return entries


# --- CLI --------------------------------------------------------------------


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.synth",
        description="Generate labelled synthetic card 'photos' (see module docstring).",
    )
    parser.add_argument("--out", required=True, help="output directory (created)")
    parser.add_argument("--n", type=int, default=None, help="number of images (default 50)")
    parser.add_argument("--seed", type=int, default=None, help="RNG seed (default 0)")
    parser.add_argument("--preset", choices=sorted(PRESETS), default="mixed")
    parser.add_argument("--cards", choices=("fake", "cache"), default=None)
    parser.add_argument("--cache-limit", type=int, default=None, help="cached faces to sample")
    parser.add_argument(
        "--backgrounds",
        default="procedural",
        help="'procedural', a directory of background photos, or 'both:DIR'",
    )
    parser.add_argument("--long-edge", type=int, default=None, help="canvas long edge (px)")
    parser.add_argument("--min-cards", type=int, default=None)
    parser.add_argument("--max-cards", type=int, default=None)
    parser.add_argument("--max-overlap", type=float, default=None, help="max IoU between cards")
    parser.add_argument("--export-yolo", action="store_true", help="also write labels/*.txt")
    parser.add_argument("--no-degrade", action="store_true", help="skip photo degradation")
    args = parser.parse_args(argv)

    params = replace(PRESETS[args.preset])
    regression = args.preset == "regression"
    n = args.n if args.n is not None else (REGRESSION_N if regression else 50)
    seed = args.seed if args.seed is not None else (REGRESSION_SEED if regression else 0)
    overrides = {
        "cards": args.cards,
        "cache_limit": args.cache_limit,
        "long_edge": args.long_edge,
        "min_cards": args.min_cards,
        "max_cards": args.max_cards,
        "max_overlap": args.max_overlap,
    }
    params = replace(params, **{k: v for k, v in overrides.items() if v is not None})
    params.export_yolo = args.export_yolo
    params.degrade = not args.no_degrade
    if args.backgrounds != "procedural":
        if args.backgrounds.startswith("both:"):
            params.background_source = "both"
            params.background_dir = Path(args.backgrounds[len("both:") :])
        else:
            params.background_source = "dir"
            params.background_dir = Path(args.backgrounds)
    if params.min_cards < 1 or params.max_cards < params.min_cards:
        parser.error("--min-cards must be >= 1 and <= --max-cards")

    print(
        f"Writing {n} composites to {args.out} (preset={params.preset}, seed={seed}, "
        f"cards={params.cards}, long_edge={params.long_edge}, "
        f"backgrounds={params.background_source})"
    )
    t0 = time.perf_counter()
    entries = write_dataset(args.out, n, seed, params, log=print)
    dt = time.perf_counter() - t0
    n_cards = sum(len(e["cards"]) for e in entries)
    print(
        f"Done: {len(entries)} images, {n_cards} cards, {dt:.1f} s "
        f"({len(entries) / max(dt, 1e-9):.1f} composites/s). Manifest: "
        f"{Path(args.out) / 'test-images.json'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

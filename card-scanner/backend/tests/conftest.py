"""
Shared fixtures for the card-scanner backend test-suite.

Three things happen here that every test relies on:

1. **Environment is pinned before ``app.*`` is imported.** ``app.config`` reads its
   env vars once at import time and ``app.main`` creates + mounts ``CARDS_DIR`` on
   import, so the overrides (a throw-away crops directory, an unroutable database
   URL, no image cache) must be in ``os.environ`` first. Hence the imports below the
   env block carry ``noqa: E402``.
2. **Unit tests can never touch Postgres.** The autouse ``no_db`` fixture makes
   ``index_db.get_pool`` raise immediately. Without it ``psycopg_pool`` would block
   for its 10 s connection timeout before ``matcher._ensure_loaded`` swallowed the
   error, and every matcher/API test would silently take ten seconds.
3. **Synthetic data instead of Wizards-owned images.** ``app.synth`` renders fake,
   procedurally-drawn cards; ``fake_index`` turns twelve of them (plus one sibling
   printing) into an in-memory identification index by monkeypatching the matcher's
   cache and the two ``index_db`` calls ``matcher._rank`` makes.

Marker policy: ``integration`` tests (real Postgres) run only with
``SCANNER_INTEGRATION=1``; ``network`` tests (Scryfall) only with ``SCANNER_NETWORK=1``.
"""

from __future__ import annotations

import os
import tempfile
from collections import OrderedDict

os.environ["CARDS_DIR"] = tempfile.mkdtemp(prefix="card-scanner-tests-")
# Port 1 on loopback is unroutable, so even a test that slips past ``no_db`` fails
# fast instead of talking to a developer's live index.
os.environ["DATABASE_URL"] = "postgresql://nobody@127.0.0.1:1/none"
os.environ["IMAGE_CACHE_DIR"] = ""
# Unit tests never OCR: the real ONNX models would otherwise be loaded from
# OCR_MODEL_DIR on this host and make the matcher tests slow and model-dependent.
os.environ["OCR_ENABLED"] = "0"

import contextlib  # noqa: E402
from dataclasses import dataclass, field  # noqa: E402

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

from app import features, hashing, index_db, matcher  # noqa: E402
from app.synth import make_fake_card, procedural_background, rounded_rect_mask  # noqa: E402

# --- Marker gating -------------------------------------------------------------


def pytest_collection_modifyitems(config, items):
    """Skip opt-in markers unless their env switch is set (see module docstring)."""
    gates = {
        "integration": ("SCANNER_INTEGRATION", "needs Postgres; set SCANNER_INTEGRATION=1"),
        "network": ("SCANNER_NETWORK", "talks to Scryfall; set SCANNER_NETWORK=1"),
    }
    for item in items:
        for marker, (env, reason) in gates.items():
            if marker in item.keywords and os.environ.get(env) != "1":
                item.add_marker(pytest.mark.skip(reason=reason))


# --- Isolation ----------------------------------------------------------------


@pytest.fixture(autouse=True)
def no_db(request, monkeypatch):
    """Block database access and reset the matcher cache for every unit test.

    Integration tests (marked ``integration``) manage their own pool and cache, so
    they get the real ``get_pool`` untouched.
    """
    # RANSAC inside ``cv2.findHomography`` draws from OpenCV's global RNG; seeding it
    # per test makes inlier counts reproducible regardless of test order/selection.
    cv2.setRNGSeed(0)
    if request.node.get_closest_marker("integration"):
        yield
        return

    def _blocked_pool():
        raise RuntimeError("DB access in unit test")

    monkeypatch.setattr(index_db, "get_pool", _blocked_pool)
    # A fresh dict (not a mutation of the module's) so nothing leaks between tests.
    monkeypatch.setattr(
        matcher, "_cache", {"sig": None, "checked_at": 0.0, "ids": None, "hashes": None}
    )
    # The deserialised-feature LRU is keyed by row id, which fake indexes reuse.
    monkeypatch.setattr(matcher, "_feature_cache", OrderedDict())
    yield


# --- Synthetic cards ----------------------------------------------------------

FAKE_CARD_COUNT = 12
_CARD_SEED = 1234
_card_cache: dict[int, np.ndarray] = {}


def fake_card_image(index: int) -> np.ndarray:
    """Fake card ``index`` (BGR), identical no matter how many cards were made before.

    Each index gets its own ``default_rng([seed, index])`` stream so a test asking for
    card 7 alone sees exactly the card that ``fake_cards`` puts at position 7.
    """
    if index not in _card_cache:
        _card_cache[index] = make_fake_card(np.random.default_rng([_CARD_SEED, index]), index)
    return _card_cache[index].copy()


@pytest.fixture
def rng() -> np.random.Generator:
    """A fresh, seeded generator for tests that need their own randomness."""
    return np.random.default_rng(1234)


@pytest.fixture
def fake_card():
    """Factory fixture: ``fake_card(i)`` -> the BGR image of fake card ``i``."""
    return fake_card_image


@pytest.fixture
def fake_cards() -> list[np.ndarray]:
    """Twelve distinct fake cards, index == position."""
    return [fake_card_image(i) for i in range(FAKE_CARD_COUNT)]


def perspective_jitter(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """A mild, frame-filling perspective + lighting jitter of a card image.

    Samples a quad up to 3 % inside each corner and stretches it to fill the frame,
    then nudges contrast/brightness — the residual a real de-skew leaves behind, so
    matcher tests exercise "same card, imperfect crop" rather than a byte-identical
    query.
    """
    h, w = image.shape[:2]
    mx, my = 0.03 * w, 0.03 * h
    src = np.float32(
        [
            [rng.uniform(0, mx), rng.uniform(0, my)],
            [w - rng.uniform(0, mx), rng.uniform(0, my)],
            [w - rng.uniform(0, mx), h - rng.uniform(0, my)],
            [rng.uniform(0, mx), h - rng.uniform(0, my)],
        ]
    )
    dst = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    out = cv2.warpPerspective(image, cv2.getPerspectiveTransform(src, dst), (w, h))
    return cv2.convertScaleAbs(out, alpha=1.05, beta=8)


@pytest.fixture
def jitter():
    """Factory fixture exposing :func:`perspective_jitter`."""
    return perspective_jitter


# --- Fake identification index -------------------------------------------------


def sibling_printing(card: np.ndarray) -> np.ndarray:
    """The same card art re-issued with a different border colour.

    Models an alternate printing of the same oracle card: pHash and ORB features are
    nearly identical, so it scores close to the original — which is exactly what the
    matcher's same-oracle margin rule is meant to tolerate.
    """
    out = card.copy()
    border = np.all(out == (10, 10, 10), axis=-1)  # make_fake_card's black border
    out[border] = (90, 60, 40)
    return out


def make_index_row(row_id: int, scryfall_id: str, oracle_id: str, image: np.ndarray) -> dict:
    """Build one ``cards`` row exactly as ``index_db.load_rows`` would return it.

    Uses the real hashing/feature code so tests exercise genuine descriptors; the
    ``phash`` is the 8-byte big-endian BYTEA form the database stores.
    """
    keypoints, descriptors = features.compute_descriptors(image)
    kp_blob, desc_blob = features.serialize_features(keypoints, descriptors)
    return {
        "id": row_id,
        "scryfall_id": scryfall_id,
        "oracle_id": oracle_id,
        "name": f"Fake Card {scryfall_id}",
        "set_code": "fak",
        "collector_number": str(row_id),
        "face": "single",
        "image_url": None,
        "scryfall_uri": None,
        "phash": hashing.compute_phash(image).to_bytes(8, "big"),
        "kp_pts": kp_blob,
        "descriptors": desc_blob,
    }


@dataclass
class FakeIndex:
    """An in-memory stand-in for the Postgres index (see the ``fake_index`` fixture).

    Attributes:
        rows: ``row_id -> row dict`` (what ``index_db.load_rows`` returns).
        images: ``row_id -> source BGR image`` each row was built from.
        distinct_ids: Row ids of the twelve distinct fake cards.
        sibling_id: Row id of the alternate printing of card 3 (same ``oracle_id``).
    """

    rows: dict[int, dict] = field(default_factory=dict)
    images: dict[int, np.ndarray] = field(default_factory=dict)
    distinct_ids: list[int] = field(default_factory=list)
    sibling_id: int = -1

    def add(self, row_id: int, scryfall_id: str, oracle_id: str, image: np.ndarray) -> dict:
        """Add a row and its source image (call :meth:`install` afterwards)."""
        row = make_index_row(row_id, scryfall_id, oracle_id, image)
        self.rows[row_id] = row
        self.images[row_id] = image
        return row

    def install(self) -> None:
        """Push the current rows into the matcher's Stage-1 cache arrays."""
        ids = np.array(sorted(self.rows), dtype=np.int64)
        hashes = np.array(
            [int.from_bytes(self.rows[i]["phash"], "big") for i in ids], dtype=np.uint64
        )
        matcher._cache.update(sig="fake", ids=ids, hashes=hashes, checked_at=float("inf"))


@pytest.fixture(scope="session")
def _fake_index_rows() -> FakeIndex:
    """Descriptor extraction for 13 cards is ~0.3 s; do it once per session."""
    index = FakeIndex()
    for i in range(FAKE_CARD_COUNT):
        index.add(i, f"fake-{i}", f"oracle-{i}", fake_card_image(i))
        index.distinct_ids.append(i)
    index.sibling_id = FAKE_CARD_COUNT
    index.add(index.sibling_id, "fake-3-alt", "oracle-3", sibling_printing(fake_card_image(3)))
    return index


@pytest.fixture
def fake_index(_fake_index_rows: FakeIndex, monkeypatch) -> FakeIndex:
    """Wire a fresh copy of the fake rows into ``matcher`` for one test.

    ``_ensure_loaded`` becomes a no-op (the cache is pre-filled by ``install``),
    ``index_db.connection`` yields ``None`` and ``index_db.load_rows`` serves from the
    dict — so ``matcher.identify`` runs both real stages with zero database calls.
    """
    index = FakeIndex(
        rows=dict(_fake_index_rows.rows),
        images=dict(_fake_index_rows.images),
        distinct_ids=list(_fake_index_rows.distinct_ids),
        sibling_id=_fake_index_rows.sibling_id,
    )
    monkeypatch.setattr(matcher, "_ensure_loaded", lambda: None)
    monkeypatch.setattr(index_db, "connection", lambda: contextlib.nullcontext(None))
    monkeypatch.setattr(
        index_db, "load_rows", lambda conn, ids: {i: index.rows[i] for i in ids if i in index.rows}
    )
    index.install()
    return index


# --- API client ----------------------------------------------------------------


@pytest.fixture
def client(monkeypatch):
    """A Starlette ``TestClient`` for the FastAPI app, with identification stubbed.

    Deliberately NOT used as a context manager: entering it would run the lifespan,
    whose ``init_db`` retries five times with a one-second sleep each against the
    blocked pool. ``matcher.identify`` / ``identify_card`` are stubbed to empty so scan tests exercise
    detection + file writing; override it in a test to check match plumbing.
    """
    from starlette.testclient import TestClient

    from app import main

    monkeypatch.setattr(matcher, "identify", lambda crop, top_n=None, **kw: [])
    monkeypatch.setattr(
        matcher,
        "identify_card",
        lambda crop, top_n=None, **kw: matcher.IdentifyResult(matches=[]),
    )
    return TestClient(main.app)


# --- Simple composite photos ---------------------------------------------------


def compose_simple(
    rng: np.random.Generator,
    cards: list[np.ndarray],
    background: str | np.ndarray,
    placements: list[tuple[float, float, float, float]],
    size: tuple[int, int] = (1600, 1200),
) -> tuple[np.ndarray, list[np.ndarray]]:
    """Paste fake cards onto a background with an affine placement each.

    Kept deliberately simple (rotation + uniform scale, no perspective, no shadows)
    and independent of the richer composite generator elsewhere in the project: it
    only exists to give the detector and the API an image with known ground truth.

    Args:
        rng: Drives the procedural background when ``background`` is a kind name.
        cards: Portrait BGR card images (white outside the rounded corners).
        background: A ``BACKGROUND_KINDS`` name or a ready-made ``H x W x 3`` canvas.
        placements: One ``(cx, cy, angle_deg, scale)`` per card — the card's centre in
            canvas pixels, its counter-clockwise rotation and its size multiplier.
        size: ``(width, height)`` of the canvas when generating a background.

    Returns:
        ``(image, quads)`` where each quad is a ``(4, 2)`` float32 array of the card's
        TL, TR, BR, BL corners (card frame, before rotation) in canvas coordinates.
    """
    if isinstance(background, str):
        width, height = size
        canvas = procedural_background(rng, width, height, background)
    else:
        canvas = background.copy()
        height, width = canvas.shape[:2]

    quads: list[np.ndarray] = []
    for card, (cx, cy, angle, scale) in zip(cards, placements, strict=True):
        h, w = card.shape[:2]
        matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, scale)
        matrix[:, 2] += (cx - w / 2, cy - h / 2)  # move the card centre to (cx, cy)
        warped = cv2.warpAffine(card, matrix, (width, height), flags=cv2.INTER_LINEAR)
        # The rounded-corner mask doubles as alpha so the white corner pixels of the
        # fake card do not end up in the photo.
        alpha = cv2.warpAffine(rounded_rect_mask(w, h), matrix, (width, height))
        a = (alpha.astype(np.float32) / 255.0)[..., None]
        canvas = (warped * a + canvas * (1.0 - a)).astype(np.uint8)

        corners = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
        quads.append(cv2.transform(corners.reshape(1, 4, 2), matrix).reshape(4, 2))
    return canvas, quads


@pytest.fixture(name="compose_simple")
def compose_simple_fixture():
    """Factory fixture exposing :func:`compose_simple`."""
    return compose_simple

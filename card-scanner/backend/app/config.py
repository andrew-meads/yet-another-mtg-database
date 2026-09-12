"""
Application configuration for the MTG card-scanner backend.

Every tunable value lives here so the OpenCV pipeline and the web layer can be
adjusted without touching code. Each value can be overridden with an environment
variable (handy in Docker), falling back to a sensible default for local dev.
"""

from __future__ import annotations

import os
from pathlib import Path


def _env_float(name: str, default: float) -> float:
    """Read an environment variable as a float, falling back to ``default``."""
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    """Read an environment variable as an int, falling back to ``default``."""
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    """Read an environment variable as a bool (``0/false/no`` are falsey)."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


# --- Filesystem -------------------------------------------------------------

# Directory where de-skewed card crops (and debug overlays) are written. The
# FastAPI app serves this directory as static files under the /cards URL prefix.
# Default: <repo>/data/cards. config.py lives at backend/app/config.py, so
# parents[2] is the repo root.
CARDS_DIR = Path(
    os.environ.get(
        "CARDS_DIR",
        str(Path(__file__).resolve().parents[2] / "data" / "cards"),
    )
)

# --- Detection tuning -------------------------------------------------------

# Long edge (px) that the working copy is downscaled to before contour finding.
# Smaller = faster and less noise-sensitive; detected corners are mapped back
# onto the full-resolution original so output sharpness is unaffected.
WORK_LONG_EDGE = _env_int("WORK_LONG_EDGE", 1000)

# A detected quad must cover at least this fraction of the frame to count as a
# card (filters out specks, text and logos)...
MIN_AREA_RATIO = _env_float("MIN_AREA_RATIO", 0.02)
# ...and at most this fraction, so a near-full-frame border isn't mistaken for one.
MAX_AREA_RATIO = _env_float("MAX_AREA_RATIO", 0.98)

# approxPolyDP epsilon as a fraction of the contour perimeter. Larger simplifies
# more aggressively; ~2% reliably collapses a card outline to four corners.
APPROX_EPSILON_RATIO = _env_float("APPROX_EPSILON_RATIO", 0.02)

# Canny hysteresis thresholds (low, high).
CANNY_LOW = _env_int("CANNY_LOW", 75)
CANNY_HIGH = _env_int("CANNY_HIGH", 200)

# --- Output normalization ---------------------------------------------------

# Output card height in px; width is derived from the MTG aspect ratio below.
# 680 px height -> ~487 px width, matching Scryfall's "normal" image size, which
# is convenient for the Part-2 pHashing step.
OUTPUT_HEIGHT = _env_int("OUTPUT_HEIGHT", 680)

# A real MTG card is 63mm x 88mm -> width/height aspect ratio (~0.7159).
CARD_ASPECT_RATIO = 63.0 / 88.0

# Output width derived from the height and the fixed card aspect ratio.
OUTPUT_WIDTH = round(OUTPUT_HEIGHT * CARD_ASPECT_RATIO)

# Whether to also write an annotated copy of the original frame with detected
# quads drawn (returned as ``debugUrl``). On by default for the prototype because
# it makes CV tuning much easier.
SAVE_DEBUG_OVERLAY = _env_bool("SAVE_DEBUG_OVERLAY", True)

# JPEG quality (0-100) for saved crops.
JPEG_QUALITY = _env_int("JPEG_QUALITY", 92)

# --- Part 2: card identification index --------------------------------------
# PostgreSQL connection string for the identification index (pHash + feature
# descriptors). Compose points the host at the `db` service; the local default
# targets a Postgres on localhost. Format: postgresql://user:pass@host:port/db
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://cardscanner:cardscanner@localhost:5432/cardscanner"
)

# The matcher caches the hash table in memory; it re-checks the DB for changes at
# most this often (seconds) so a running index build is picked up without
# re-querying every request.
INDEX_REFRESH_SECONDS = _env_float("INDEX_REFRESH_SECONDS", 5.0)

# Where the index builder appends full per-card error details (with tracebacks)
# for later inspection. Defaults under CARDS_DIR so it's host-visible via the
# bind mount (plain append-only text — no SQLite-style locking concerns).
INDEX_ERROR_LOG = Path(
    os.environ.get("INDEX_ERROR_LOG", str(CARDS_DIR / "index_errors.log"))
)

# Stage 1 — perceptual hash (recall). 8 -> a 64-bit DCT pHash; the working
# resolution fed to the DCT is hash_size * highfreq_factor (= 32x32 by default).
PHASH_SIZE = _env_int("PHASH_SIZE", 8)
PHASH_HIGHFREQ_FACTOR = _env_int("PHASH_HIGHFREQ_FACTOR", 4)
# How many nearest-by-hash candidates to pass on to Stage 2. Tuned for recall:
# the true card only has to land *somewhere* in this shortlist. Wider helps a lot
# at full-collection scale (115k cards), at the cost of more Stage-2 work/query.
SHORTLIST_K = _env_int("SHORTLIST_K", 100)

# Stage 2 — local feature re-rank (precision).
# Detector: "orb" (free, compact binary descriptors) or "sift" (richer, larger).
FEATURE_DETECTOR = os.environ.get("FEATURE_DETECTOR", "orb").strip().lower()
ORB_FEATURES = _env_int("ORB_FEATURES", 500)
SIFT_FEATURES = _env_int("SIFT_FEATURES", 500)
# Lowe ratio-test cutoff for accepting a descriptor match.
RATIO_TEST = _env_float("RATIO_TEST", 0.75)
# Confidence floors: a best match below these is flagged low-confidence (still
# returned so a human can inspect the top-N).
MIN_GOOD_MATCHES = _env_int("MIN_GOOD_MATCHES", 8)
MIN_INLIERS = _env_int("MIN_INLIERS", 15)
# The top match is only "confident" if its inlier count also beats the runner-up
# by at least this factor (a clear winner, not a near-tie). Cuts false-confident.
CONFIDENT_MARGIN = _env_float("CONFIDENT_MARGIN", 2.0)

# How many ranked candidates to return per detected card.
TOP_N_MATCHES = _env_int("TOP_N_MATCHES", 5)

# Scryfall ingestion etiquette: identify ourselves and throttle requests.
SCRYFALL_USER_AGENT = os.environ.get(
    "SCRYFALL_USER_AGENT", "card-scanner-prototype/0.1 (local prototype)"
)
SCRYFALL_REQUEST_DELAY = _env_float("SCRYFALL_REQUEST_DELAY", 0.1)
# Which Scryfall image size to index/hash ("small" | "normal" | "large").
SCRYFALL_IMAGE_FORMAT = os.environ.get("SCRYFALL_IMAGE_FORMAT", "normal").strip()

# Set types skipped by the "index all English sets" convenience — these add no
# value to a collection index (tokens, minigames, etc.). Comma-separated env
# override. See Scryfall's set object `set_type` field for the full vocabulary.
EXCLUDED_SET_TYPES = {
    t.strip()
    for t in os.environ.get(
        "EXCLUDED_SET_TYPES", "minigame,token,vanguard,treasure_chest"
    ).split(",")
    if t.strip()
}

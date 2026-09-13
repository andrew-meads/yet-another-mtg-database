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
    except KeyError, ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    """Read an environment variable as an int, falling back to ``default``."""
    try:
        return int(os.environ[name])
    except KeyError, ValueError:
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
MIN_AREA_RATIO = _env_float("MIN_AREA_RATIO", 0.01)
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
INDEX_ERROR_LOG = Path(os.environ.get("INDEX_ERROR_LOG", str(CARDS_DIR / "index_errors.log")))

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
    for t in os.environ.get("EXCLUDED_SET_TYPES", "minigame,token,vanguard,treasure_chest").split(
        ","
    )
    if t.strip()
}

# --- OCR (Stage 1.5: card-name / collector-line reading) --------------------
# Where the ONNX model files live. The Docker image downloads them at build time
# (see app/ocr_models.py and the Dockerfile); on the host `make models` fills
# ./models. Each *_MODEL value is a key of app.ocr_models.MODELS, so switching to
# a different detector/recogniser is a config change plus a rebuild.
OCR_MODEL_DIR = Path(
    os.environ.get("OCR_MODEL_DIR", str(Path(__file__).resolve().parents[1] / "models"))
)
OCR_DET_MODEL = os.environ.get("OCR_DET_MODEL", "det:PP-OCRv6_small").strip()
OCR_CLS_MODEL = os.environ.get("OCR_CLS_MODEL", "cls:PP-OCRv5_mobile").strip()
OCR_REC_MODEL = os.environ.get("OCR_REC_MODEL", "rec:en_PP-OCRv5_mobile").strip()

# --- Scryfall image cache ---------------------------------------------------
# On-disk cache of the card images downloaded from Scryfall, shared by the index
# builder, the identification harness and the synthetic-composite generator, so
# a re-index or a harness run never re-downloads an image it already has.
#
# Layout: <IMAGE_CACHE_DIR>/<image format>/<sid[:2]>/<scryfall_id>_<face>.jpg.
# A full "normal"-size cache of the whole index (~115k faces at ~65 KB) is about
# 7.5 GB; `python -m app.image_cache warm --set CODE` fills it one set at a time
# and `stats` / `prune --older-than DAYS` report and trim it.
#
# Default: a sibling of CARDS_DIR (<repo>/data/scryfall-cache locally; the compose
# files mount ./data/scryfall-cache and set IMAGE_CACHE_DIR=/data/scryfall-cache).
# Setting IMAGE_CACHE_DIR to the empty string disables the cache entirely
# (every image is fetched from Scryfall and nothing is written) — the test suite
# does this so no test can leave files behind or read a stale one.
_image_cache_env = os.environ.get("IMAGE_CACHE_DIR")
IMAGE_CACHE_DIR: Path | None = (
    CARDS_DIR.parent / "scryfall-cache"
    if _image_cache_env is None
    else (Path(_image_cache_env) if _image_cache_env.strip() else None)
)

# OCR behaviour (app/ocr.py). Measured on real crops: text detection + the line
# classifier cost ~50-80 ms per crop, recognition ~20 ms per line, so recognising
# only the tallest lines (titles) plus the top/bottom bands (collector line) is what
# keeps a crop under ~200 ms. OCR_ENABLED=0 returns the matcher to the pure
# pHash -> ORB path.
OCR_ENABLED = _env_bool("OCR_ENABLED", True)
# onnxruntime intra-op threads for the OCR session (multi-card photos also run crops
# in parallel, so keep this modest to avoid oversubscription).
OCR_THREADS = _env_int("OCR_THREADS", 4)
# Tallest text boxes recognised from the full-crop pass (titles are the tallest lines
# on virtually every frame; rules text is excluded by this cap).
OCR_MAX_LINES = _env_int("OCR_MAX_LINES", 6)
# Boxes whose text height is below this fraction of the crop height are ignored in
# the full pass (they are unreadable at crop resolution anyway).
OCR_MIN_LINE_HEIGHT_FRAC = _env_float("OCR_MIN_LINE_HEIGHT_FRAC", 0.02)
# Top/bottom band (fraction of card height) that holds the collector line; boxes in
# it are always recognised, and the band passes re-read it at higher resolution.
OCR_BAND_FRACTION = _env_float("OCR_BAND_FRACTION", 0.10)
# Run the extra top/bottom band passes (higher-res re-read of the collector line).
OCR_BAND_PASSES = _env_bool("OCR_BAND_PASSES", True)
# Recognised lines below this confidence are dropped. Measured: titles and collector
# numbers score 0.95+, set/artist lines 0.78-0.95, foil-glare / non-Latin garbage
# 0.5-0.71 - so 0.7 keeps the useful lines and drops most noise.
OCR_MIN_CONF = _env_float("OCR_MIN_CONF", 0.7)
# Detector input cap (long side, px). Crops are 680 tall so this only matters for
# the band passes on the 2x warp.
OCR_DET_LIMIT_SIDE = _env_int("OCR_DET_LIMIT_SIDE", 1400)
# Height cap (px) of the pre-downsize warp kept for the band passes.
OCR_MAX_HEIGHT = _env_int("OCR_MAX_HEIGHT", 1400)

# --- Stage 2 refinements (features.py / matcher.py) --------------------------
# Both the query crop and the indexed reference are de-skewed portrait images of the
# same card, so a genuine match's homography is close to a similarity transform
# (rotation ~0 or ~180, scale ~1, no perspective). Validating it rejects the wild
# fits that let a wrong card collect "inliers".
HOMOGRAPHY_VALIDATE = _env_bool("HOMOGRAPHY_VALIDATE", True)
HOMOGRAPHY_METHOD = os.environ.get("HOMOGRAPHY_METHOD", "ransac").strip().lower()  # ransac | magsac
HOMOGRAPHY_MAX_ITERS = _env_int("HOMOGRAPHY_MAX_ITERS", 1000)
HOMOGRAPHY_CONFIDENCE = _env_float("HOMOGRAPHY_CONFIDENCE", 0.995)
HOMOGRAPHY_MAX_AREA_RATIO = _env_float("HOMOGRAPHY_MAX_AREA_RATIO", 2.0)
HOMOGRAPHY_MAX_CENTER_SHIFT = _env_float("HOMOGRAPHY_MAX_CENTER_SHIFT", 0.25)  # fraction of size
HOMOGRAPHY_MAX_PERSPECTIVE = _env_float("HOMOGRAPHY_MAX_PERSPECTIVE", 2e-3)
HOMOGRAPHY_ROTATION_TOL = _env_float("HOMOGRAPHY_ROTATION_TOL", 15.0)  # degrees from 0/180
# Deserialised ORB descriptors of recently scored rows are kept in memory: the same
# cards recur across the photos of one collection, and loading + decoding blobs was
# half of Stage 2's latency. ~20 KB per row.
DESC_CACHE_ROWS = _env_int("DESC_CACHE_ROWS", 5000)
# Early exit: after each chunk of scored rows, stop when the leader has this many
# validated inliers and beats the best *different-card* competitor by this factor
# (its sibling printings are still scored so the user can pick one).
EARLY_EXIT_CHUNK = _env_int("EARLY_EXIT_CHUNK", 25)
EARLY_EXIT_INLIERS = _env_int("EARLY_EXIT_INLIERS", 50)
EARLY_EXIT_MARGIN = _env_float("EARLY_EXIT_MARGIN", 3.0)
# Inpaint saturated, colourless blobs (specular glare on foils) before hashing the
# query. Off until the real-photo harness shows a gain.
QUERY_GLARE_MASK = _env_bool("QUERY_GLARE_MASK", False)

# --- OCR-assisted shortlist: name matching, collector line, fusion (names.py / fusion.py) ---
# Fuzzy name matching (rapidfuzz ratio, 0-100) of OCR lines against the index's keys.
NAME_MIN_SCORE = _env_int("NAME_MIN_SCORE", 80)
# Very short names ("Fog", "Opt") need an exact read; medium ones a stricter score,
# otherwise rules-text fragments match them.
NAME_SHORT_LEN = _env_int("NAME_SHORT_LEN", 5)
NAME_MID_LEN = _env_int("NAME_MID_LEN", 7)
NAME_MID_SCORE = _env_int("NAME_MID_SCORE", 90)
# Distinct name keys kept per crop, plus any within the ambiguity gap of the last.
NAME_TOP_M = _env_int("NAME_TOP_M", 3)
NAME_AMBIGUITY_GAP = _env_int("NAME_AMBIGUITY_GAP", 5)
# Secondary partial-ratio pass for long keys (a title box that swallowed the mana cost).
NAME_PARTIAL_MIN_LEN = _env_int("NAME_PARTIAL_MIN_LEN", 10)
NAME_PARTIAL_MIN_SCORE = _env_int("NAME_PARTIAL_MIN_SCORE", 92)
# Union shortlist: per matched name at most this many printings (by lowest Hamming —
# "Forest" has ~1000 rows), and a hard cap on the union passed to Stage 2.
NAME_MAX_ROWS = _env_int("NAME_MAX_ROWS", 40)
SHORTLIST_MAX = _env_int("SHORTLIST_MAX", 220)
# Score fusion: fused = validated inliers + NAME_W * name_bonus + CN_W * cn_bonus
# - HASH_W * hamming. A weak name misread (bonus <= 0.25 -> +3) can never overturn a
# strong ORB win; equal-inlier reprints are separated by the collector line.
FUSION_NAME_W = _env_float("FUSION_NAME_W", 12.0)
FUSION_CN_W = _env_float("FUSION_CN_W", 10.0)
FUSION_HASH_W = _env_float("FUSION_HASH_W", 0.05)
# Confidence rules B (name-anchored) and C (collector-anchored), and the veto.
NAME_CONFIDENT_SCORE = _env_int("NAME_CONFIDENT_SCORE", 92)
MIN_INLIERS_WITH_NAME = _env_int("MIN_INLIERS_WITH_NAME", 6)
MIN_INLIERS_WITH_CN = _env_int("MIN_INLIERS_WITH_CN", 6)
VETO_SCORE = _env_int("VETO_SCORE", 95)
# Include the recognised OCR lines in the per-card `ocr` block of the scan response
# (the name / collector summary is always included).
OCR_LINES_IN_RESPONSE = _env_bool("OCR_LINES_IN_RESPONSE", True)

# --- Fusion extras / OCR scheduling ------------------------------------------
# Border-colour tie-break: the crop's outer ring is classified black / white /
# gold / silver and compared with the index's `border_color`. Identical-art
# printings differ by inlier noise only, so a clear mismatch (a gold-bordered
# World Championship reprint vs the black-bordered original) is worth several
# inliers. Borderless / unclassifiable crops get no bonus or penalty.
FUSION_BORDER_W = _env_float("FUSION_BORDER_W", 8.0)
# Run the OCR band passes only when the full-crop pass produced no collector-line
# hit (they cost ~50-150 ms and are usually redundant on modern cards).
OCR_BANDS_LAZY = _env_bool("OCR_BANDS_LAZY", True)
# The partial-ratio name pass must cover at least this fraction of the OCR line (a
# title box that also swallowed the mana cost and type line is ~0.43; the legal
# line that hid a 12-character key was 0.22),
# so a 12-character key cannot "match" inside a 55-character legal line.
NAME_PARTIAL_MIN_COVERAGE = _env_float("NAME_PARTIAL_MIN_COVERAGE", 0.4)

# --- Detection strategies / verification / refinement / debug (detection.py, ---
# --- candidates.py, verify.py) ------------------------------------------------
# The detector runs a small, bounded sweep of classical strategies, filters the
# resulting quads geometrically, verifies each survivor against the pHash index,
# de-duplicates, then refines and warps the winners at full resolution. Every knob
# is env-overridable; the README's config table mirrors this block.


def _env_list(name: str, default: str) -> tuple[str, ...]:
    """Read a comma-separated environment variable as a tuple of trimmed strings."""
    raw = os.environ.get(name, default)
    return tuple(item.strip() for item in raw.split(",") if item.strip())


def _env_floats(name: str, default: str) -> tuple[float, ...]:
    """Read a comma-separated environment variable as a tuple of floats."""
    try:
        return tuple(float(v) for v in _env_list(name, default))
    except ValueError:
        return tuple(float(v) for v in default.split(","))


def _env_ints(name: str, default: str) -> tuple[int, ...]:
    """Read a comma-separated environment variable as a tuple of ints."""
    try:
        return tuple(int(v) for v in _env_list(name, default))
    except ValueError:
        return tuple(int(v) for v in default.split(","))


# Which candidate strategies run, in order: "edges" (multi-channel Canny sweep) and
# "color" (background-colour model). Drop one to isolate its effect in the harness.
DETECT_STRATEGIES = _env_list("DETECT_STRATEGIES", "edges,color")
# Working long edges (px) the sweep runs at; the first is the primary scale that
# verification and NMS use. Adding a coarse 500 px pass ("1000,500") suppresses
# wood grain and fine weave that flood the edge map at 1000 px, at ~+10 ms. Off by
# default until the harness shows a gain on real textured surfaces.
WORK_LONG_EDGES = _env_ints("WORK_LONG_EDGES", "1000")
# "auto" derives Canny thresholds from each channel's median intensity
# (lo = (1-σ)·med, hi = (1+σ)·med) so low-contrast edges on dark or mid-tone
# surfaces are still found; "fixed" uses CANNY_LOW/CANNY_HIGH and reproduces the
# original single-strategy detector exactly.
CANNY_MODE = os.environ.get("CANNY_MODE", "auto").strip().lower()  # auto | fixed
# Sigmas for the auto mode; 0.33 is the classic "auto-Canny" value, 0.66 opens the
# hysteresis band for faint outlines (dark border on a dark table).
CANNY_SIGMAS = _env_floats("CANNY_SIGMAS", "0.33,0.66")
# Gaussian blur kernel sizes (odd). 5 keeps sharp outlines on clean surfaces; 9
# smooths wood grain / cloth weave so the card outline dominates the edge map.
BLUR_KERNELS = _env_ints("BLUR_KERNELS", "5,9")
# Channels whose edge maps are OR-ed with the grey map: HSV saturation and Lab a/b
# see the chroma step between a black border and a coloured mat/wood that the
# luminance channel misses. The grey-only map is always tried as well.
EDGE_CHANNELS = _env_list("EDGE_CHANNELS", "gray,s,a,b")
# CLAHE on the grey channel before Canny lifts faint edges in under-exposed photos,
# at the cost of amplifying surface texture; off by default, measure per surface.
EDGE_CLAHE = _env_bool("EDGE_CLAHE", False)
# Kernel of the morphological *close* variant (the dilate variant uses 3x3). A 7x7
# close bridges glare and low-contrast gaps in the outline that a dilate leaves open.
MORPH_CLOSE_KERNEL = _env_int("MORPH_CLOSE_KERNEL", 7)
# "list" returns nested contours too: on a textured surface the card is often an
# *inner* contour of a background blob and RETR_EXTERNAL never sees it. "external"
# is the old behaviour.
CONTOUR_MODE = os.environ.get("CONTOUR_MODE", "list").strip().lower()  # list | external
# Largest-first cap on quads taken from any single strategy/pass so a busy edge map
# cannot turn verification into hundreds of hash lookups.
MAX_CANDIDATES_PER_STRATEGY = _env_int("MAX_CANDIDATES_PER_STRATEGY", 60)
# approxPolyDP epsilons (fraction of the hull perimeter) tried in order; the larger
# ones absorb rounded corners and JPEG wobble that keep a card at 5-6 vertices.
APPROX_EPSILONS = _env_floats("APPROX_EPSILONS", "0.02,0.03,0.05")
# Geometric filters (reason codes in candidates.filter_candidates). Contour area
# over the area of its minimum bounding box: a clean card scores ~1, a notched
# blob or a triangle that happened to approximate to four points scores low.
MIN_RECTANGULARITY = _env_float("MIN_RECTANGULARITY", 0.85)
# Below MIN_RECTANGULARITY a quad still passes when its outline is almost fully on
# the edge map with square corners (a thin outline traced as a partial ring —
# borderless cards, black borders on dark tables): the fill floor that then applies,
# the edge-support and corner-angle bars that unlock it.
MIN_RECTANGULARITY_SUPPORTED = _env_float("MIN_RECTANGULARITY_SUPPORTED", 0.5)
SUPPORTED_MIN_EDGE_SUPPORT = _env_float("SUPPORTED_MIN_EDGE_SUPPORT", 0.95)
SUPPORTED_MAX_ANGLE_DEV_DEG = _env_float("SUPPORTED_MAX_ANGLE_DEV_DEG", 10.0)
# ... and never for a quad spanning this fraction of the frame in both directions
# (the frame border is on the edge map too; without an index such a quad would win NMS
# by area and swallow every card in the photo).
SUPPORTED_MAX_FRAME_FRACTION = _env_float("SUPPORTED_MAX_FRAME_FRACTION", 0.9)
# Stricter fill required before the minAreaRect *fallback* in quad_from_contour is
# trusted (it invents corners, so the hull must really be a box).
MIN_RECTANGULARITY_BOX = _env_float("MIN_RECTANGULARITY_BOX", 0.90)
# Shortest quad side (px at the primary working scale). Below this the crop cannot
# be identified anyway, and specks/logos are rejected before verification.
MIN_SIDE_PX = _env_int("MIN_SIDE_PX", 40)
# Interior angles must be within this of 90°: a flat card under a sensible camera
# angle stays near-rectangular; sharper corners are shadows or paper edges.
MAX_ANGLE_DEV_DEG = _env_float("MAX_ANGLE_DEV_DEG", 30.0)
# Short/long side ratio band. A real card is 63:88 = 0.716; perspective can
# compress either axis, hence the width. 0.92 keeps squares out (tiles, dice).
ASPECT_MIN = _env_float("ASPECT_MIN", 0.55)
ASPECT_MAX = _env_float("ASPECT_MAX", 0.92)
# Fraction of the quad's perimeter that must lie on an edge/mask-boundary pixel.
# Hallucinated quads from intersecting long edges score low here.
MIN_EDGE_SUPPORT = _env_float("MIN_EDGE_SUPPORT", 0.5)
# How far (fraction of the quad's long edge, at least 2 px) a perimeter point may
# be from the nearest support pixel and still count. The polygon approximation
# runs a few px off the contour along a side; a hallucinated side is off by tens.
EDGE_SUPPORT_TOLERANCE = _env_float("EDGE_SUPPORT_TOLERANCE", 0.01)
# Near-duplicate quads (same card from several passes) are merged at this IoU
# before verification so each card is hashed once.
DEDUP_IOU = _env_float("DEDUP_IOU", 0.9)
# Non-maximum suppression across strategies: IoU for overlapping duplicates and
# containment for nested ones (the art box inside a card, the inset colour-mask
# quad inside its expanded twin).
NMS_IOU = _env_float("NMS_IOU", 0.5)
NMS_CONTAINMENT = _env_float("NMS_CONTAINMENT", 0.9)
# Tie-break among *unverified* candidates (no index): "area" prefers the outer
# quad (the original detector's outermost-contour prior; loses to a tile line or
# shadow that extends a quad), "score" prefers the better-proportioned, better
# supported one (loses to a card's inner frame under a strong tilt). Verified
# candidates always order by hash distance, then score.
NMS_UNVERIFIED_ORDER = os.environ.get("NMS_UNVERIFIED_ORDER", "area").strip().lower()
# A kept quad no larger than this fraction of a later same-tier quad that contains it, and
# within this many hash bits of it, gives the slot up when the larger one scores better —
# a glare-cut half of a card hashes about as well as the card and must not suppress it.
NMS_NESTED_SWAP_RATIO = _env_float("NMS_NESTED_SWAP_RATIO", 0.6)
NMS_NESTED_SWAP_MAX_GAP = _env_int("NMS_NESTED_SWAP_MAX_GAP", 4)
# Unverified candidates re-found by at least this many sweep passes ("hits") rank
# ahead of one-off quads regardless of size. A card outline is found by ~30 of
# the 32 passes; a card glued to a tile line or a shadow, or a colour-mask blob,
# is found once.
NMS_CONSENSUS_HITS = _env_int("NMS_CONSENSUS_HITS", 6)
# Hard cap on cards returned per photo (a binder page is 9; 24 leaves headroom).
MAX_CARDS = _env_int("MAX_CARDS", 24)

# pHash verification of candidates (verify.py). Each survivor is warped to a small
# portrait thumbnail and its minimum Hamming distance to the index (0° and 180°)
# decides: <= VERIFY_MAX_HAMMING accepted, <= VERIFY_AMBIGUOUS_HAMMING ambiguous
# (kept, but main.py drops it unless ORB finds >= VERIFY_MIN_INLIERS), beyond that
# rejected — in "filter" mode only. The zones come from `evaluate_photos
# --hash-histogram` against the 115k-face index, not from the 64-bit random model
# (two random hashes differ by 32 +- 4 bits, but the *minimum* over 231k hashes of
# card-like content is far lower): the detector's own crops of the 22 labelled
# cards measure 2-8 bits (one foil at 14), random card-shaped rectangles on white
# paper 10-18 (median 14), and half-cards 8-16. So 8 accepts every clean card and
# no random rectangle, everything up to 16 is left to Stage 2 (a true card with
# glare lands there and ORB keeps it), and only clear misses are rejected.
# Modes: "filter" rejects; "rank" only orders candidates by distance and never
# drops one; "off" skips hashing; "auto" picks "filter" only when the index holds
# at least VERIFY_MIN_INDEX_SIZE faces, else "rank" — a partially built per-set
# index must never silently drop cards from sets it does not contain yet.
VERIFY_MODE = os.environ.get("VERIFY_MODE", "auto").strip().lower()  # auto|rank|filter|off
VERIFY_MAX_HAMMING = _env_int("VERIFY_MAX_HAMMING", 8)
VERIFY_AMBIGUOUS_HAMMING = _env_int("VERIFY_AMBIGUOUS_HAMMING", 16)
VERIFY_MIN_INDEX_SIZE = _env_int("VERIFY_MIN_INDEX_SIZE", 50000)
# Long edge of the verification thumbnail; pHash works on 32x32 so 180 px is plenty
# and keeps the warp under 0.3 ms.
VERIFY_THUMB_LONG_EDGE = _env_int("VERIFY_THUMB_LONG_EDGE", 180)
# Stage-2 inlier floor an *ambiguous* candidate must reach in main.py to be kept.
VERIFY_MIN_INLIERS = _env_int("VERIFY_MIN_INLIERS", 8)
# At most this many ambiguous candidates go on to identification per photo (each
# costs a full Stage-2 run); the rest are dropped with reason "ambiguous-cap".
# Six rather than four because the ambiguous zone is where a foil under glare
# lands, and it competes for slots with junk at the same distance.
MAX_AMBIGUOUS = _env_int("MAX_AMBIGUOUS", 6)

# Background-colour model (candidates.color_mask_candidates). The Lab median of a
# border ring BG_BORDER_FRACTION of the short edge wide models the surface; pixels
# further than BG_DELTA_E from it are foreground. On a dark surface the black card
# border merges with the background and the blob is the *inner frame*, so each blob
# also emits a twin expanded by 63/57 x 88/82 (BG_EMIT_EXPANDED) — the printed
# frame sits ~3 mm inside the 63x88 mm card. BG_MODE "auto" skips the strategy when
# the ring's colour spread exceeds BG_MAX_SPREAD (a patterned surface has no single
# colour to model); "always" and "off" force it.
BG_MODE = os.environ.get("BG_MODE", "auto").strip().lower()  # auto | always | off
BG_BORDER_FRACTION = _env_float("BG_BORDER_FRACTION", 0.04)
BG_DELTA_E = _env_float("BG_DELTA_E", 12.0)
BG_MAX_SPREAD = _env_float("BG_MAX_SPREAD", 14.0)
BG_EMIT_EXPANDED = _env_bool("BG_EMIT_EXPANDED", True)
# Tile a candidate whose aspect matches n x m touching cards into its children
# (candidates.split_merged) so a tight row or grid is not one giant "card". On by
# default since the tight-grid photos were labelled: the seam-support test keeps a lone
# sideways card from being halved, verification keeps a hashed parent ahead of its
# tiles, and the container guard below stops the merged blob from winning NMS by area
# when there is no index to hash it away.
SPLIT_TOUCHING = _env_bool("SPLIT_TOUCHING", True)
# candidates.reject_containers: a candidate at least CONTAINER_MIN_AREA_RATIO times larger
# than, and containing, CONTAINER_MIN_CHILDREN alive candidates scoring at least
# CONTAINER_MIN_CHILD_SCORE is a row/grid of cards, not a card — unless the index accepted it.
CONTAINER_MIN_CHILDREN = _env_int("CONTAINER_MIN_CHILDREN", 2)
CONTAINER_MIN_AREA_RATIO = _env_float("CONTAINER_MIN_AREA_RATIO", 1.8)
CONTAINER_MIN_CHILD_SCORE = _env_float("CONTAINER_MIN_CHILD_SCORE", 0.8)
# ... and, when nothing was hashed at all, the (non-overlapping, independently found)
# children must together cover this fraction of the container: real tilings reach
# 95-97 %, a card's own art box plus text box at most ~87 % of an inset card quad.
CONTAINER_MIN_COVERAGE = _env_float("CONTAINER_MIN_COVERAGE", 0.92)
# candidates.complete_occluded: a card covered by another card is rebuilt from three
# visible corners when both visible sides lie on the edge map for this fraction of their
# length and the completed corner lies inside a surviving card; at most this many per
# photo. Such candidates are never better than ambiguous (VERIFY_COMPLETED_HAMMING is the
# distance a completed quad may hash at: its warp holds ~30 % of the occluder), so
# identification's ORB gate decides.
COMPLETE_OCCLUDED = _env_bool("COMPLETE_OCCLUDED", True)
COMPLETION_MIN_SIDE_SUPPORT = _env_float("COMPLETION_MIN_SIDE_SUPPORT", 0.9)
MAX_COMPLETED = _env_int("MAX_COMPLETED", 4)
COMPLETION_MIN_OVERLAP = _env_float("COMPLETION_MIN_OVERLAP", 0.05)
VERIFY_COMPLETED_HAMMING = _env_int("VERIFY_COMPLETED_HAMMING", 22)

# Full-resolution corner refinement (geometry.refine_corners): intensity profiles
# along each side's outward normal, from REFINE_BAND_IN inside to REFINE_BAND_OUT
# outside (fractions of the card's long edge), REFINE_SAMPLES profiles per side.
# 6 % outward covers the ~3.4 % inset of a colour-mask quad plus a margin.
REFINE_CORNERS = _env_bool("REFINE_CORNERS", True)
REFINE_BAND_IN = _env_float("REFINE_BAND_IN", 0.015)
REFINE_BAND_OUT = _env_float("REFINE_BAND_OUT", 0.06)
REFINE_SAMPLES = _env_int("REFINE_SAMPLES", 64)
# How far inside the coarse line profiles start; the absolute gradient floor (grey
# levels over a 0.5 % span) and the sharpness ratio a run needs; the noise factor
# (multiple of the median outward gradient) that raises the floor on texture; how
# flat the border stretch must be (grey levels); the fraction of a side's profiles
# that must vote before its line moves; the largest area change accepted (a full
# black-border inset is 0.186); whether the opt-in mean-profile border step runs on
# sides where fewer than half the profiles found an edge (measured neutral overall on
# the labelled photos: it rescues a black border on a textured mat but is fooled by
# binder-pocket texture), how far out it may look (fraction of the long edge), its
# sharpness bar and the share of the outward contrast its step must rise by.
REFINE_SEARCH_IN = _env_float("REFINE_SEARCH_IN", 0.04)
REFINE_MIN_GRADIENT = _env_float("REFINE_MIN_GRADIENT", 5.0)
REFINE_MIN_SHARPNESS = _env_float("REFINE_MIN_SHARPNESS", 0.6)
REFINE_NOISE_FACTOR = _env_float("REFINE_NOISE_FACTOR", 2.5)
REFINE_BORDER_TOLERANCE = _env_float("REFINE_BORDER_TOLERANCE", 20.0)
REFINE_MIN_SIDE_FRACTION = _env_float("REFINE_MIN_SIDE_FRACTION", 0.4)
REFINE_MAX_AREA_CHANGE = _env_float("REFINE_MAX_AREA_CHANGE", 0.35)
REFINE_BORDER_STEP = _env_bool("REFINE_BORDER_STEP", False)
REFINE_MAX_BORDER_RATIO = _env_float("REFINE_MAX_BORDER_RATIO", 0.06)
REFINE_STEP_MIN_SHARPNESS = _env_float("REFINE_STEP_MIN_SHARPNESS", 0.6)
# A border plateau may be this much brighter than the 10th percentile of what lies
# inside the coarse line and still count (a glare-washed foil border); a drop shadow on
# a light table is brighter still.
REFINE_INSIDE_TOLERANCE = _env_float("REFINE_INSIDE_TOLERANCE", 40.0)

# Debug output. The overlay draws accepted quads in green and, when
# DEBUG_OVERLAY_REJECTED, the best DEBUG_MAX_REJECTED rejected candidates coloured
# by reason with a legend and per-stage timings. DEBUG_SAVE_INTERMEDIATE also
# writes the OR-ed edge map and the colour mask next to the overlay, and
# DEBUG_JSON adds candidate counts and rejected quads/reasons to the scan response.
DEBUG_OVERLAY_REJECTED = _env_bool("DEBUG_OVERLAY_REJECTED", True)
DEBUG_MAX_REJECTED = _env_int("DEBUG_MAX_REJECTED", 40)
DEBUG_SAVE_INTERMEDIATE = _env_bool("DEBUG_SAVE_INTERMEDIATE", False)
DEBUG_JSON = _env_bool("DEBUG_JSON", False)

# Per-crop identification threads in the scan endpoint. Two keeps a multi-card photo
# responsive without oversubscribing the CPU next to OpenCV's and onnxruntime's own
# thread pools.
SCAN_WORKERS = _env_int("SCAN_WORKERS", 2)

# Which detections the Stage-2 (ORB) gate may drop after identification: "all"
# drops any detection whose best match has fewer than VERIFY_MIN_INLIERS validated
# inliers (measured on the labelled photos: every real card scored >= 26, every
# false quad 0); "ambiguous" only gates the hash-ambiguous ones. Either way the
# gate is active only when verification resolves to `filter` (a complete index),
# so cards from unindexed sets are never dropped from a partial index.
VERIFY_ORB_GATE = os.environ.get("VERIFY_ORB_GATE", "all").strip().lower()  # all | ambiguous

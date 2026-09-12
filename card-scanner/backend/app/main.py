"""
FastAPI application for the MTG card scanner (Part 1).

Endpoints:
    GET  /health     -> liveness probe.
    POST /api/scan   -> accept an uploaded photo, detect & de-skew cards, save
                        each crop, and return JSON URLs to the saved images.
    GET  /cards/...  -> static serving of the saved crops (StaticFiles mount).

De-skewed crops are written to ``config.CARDS_DIR`` and served back under the
``/cards`` URL prefix. In development a Vite proxy forwards ``/api`` and
``/cards`` to this server, so the frontend can use the relative URLs returned
here verbatim; CORS is also enabled so a phone or other direct client can call
the API straight.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config, detection, index_db, matcher

# Ensure the output directory exists before we mount/serve it.
config.CARDS_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the index tables on startup; close the DB pool on shutdown.

    A DB hiccup at startup is non-fatal — the matcher presents an empty index and
    recovers automatically once Postgres is reachable.
    """
    try:
        index_db.init_db()
    except Exception as err:  # don't crash the server if the DB is briefly down
        print(f"DB init at startup failed (will retry on demand): {err}", flush=True)
    yield
    index_db.close_pool()


app = FastAPI(title="MTG Card Scanner", version="0.1.0", lifespan=lifespan)

# Allow the Vite dev server (and, for the prototype, any origin) to call the API
# directly. Tighten ``allow_origins`` for anything beyond local prototyping.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve saved crops at /cards/<file>.
app.mount("/cards", StaticFiles(directory=str(config.CARDS_DIR)), name="cards")


@app.get("/health")
def health() -> dict:
    """Simple liveness probe used by Docker / manual checks."""
    return {"status": "ok"}


@app.get("/api/index/stats")
def index_stats() -> dict:
    """Report how many card faces are currently indexed for identification."""
    return {"cards": matcher.index_size()}


def _save_jpeg(image: np.ndarray, path: Path) -> None:
    """Encode a BGR ``image`` to JPEG on disk at ``path``.

    Raises:
        RuntimeError: If OpenCV fails to write the file.
    """
    ok = cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, config.JPEG_QUALITY])
    if not ok:
        raise RuntimeError(f"Failed to write image to {path}")


@app.post("/api/scan")
async def scan(image: UploadFile = File(...)) -> dict:
    """Detect and de-skew cards in an uploaded photo.

    Args:
        image: A multipart file field named ``image`` (a JPEG/PNG photo).

    Returns:
        JSON of the form::

            {
              "count": <int>,
              "cards": [ { "id", "url", "width", "height" }, ... ],
              "debugUrl": "/cards/<batch>_debug.jpg" | null
            }

    Raises:
        HTTPException: 400 for an empty or undecodable upload.
    """
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")

    try:
        image_bgr = detection.load_image_bgr(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    cards = detection.detect_and_deskew(image_bgr)

    # A unique batch id ties this scan's crops + debug overlay together.
    batch_id = uuid.uuid4().hex

    results = []
    for index, card in enumerate(cards):
        card_id = f"{batch_id}_{index}"
        filename = f"{card_id}.jpg"
        _save_jpeg(card.image, config.CARDS_DIR / filename)
        height, width = card.image.shape[:2]
        # Part 2: identify the de-skewed crop against the Scryfall index. Returns
        # an empty list if no index has been built yet.
        matches = matcher.identify(card.image)
        results.append(
            {
                "id": card_id,
                "url": f"/cards/{filename}",
                "width": width,
                "height": height,
                "matches": matches,
            }
        )

    # Optionally save an annotated copy of the original to aid CV tuning.
    debug_url = None
    if config.SAVE_DEBUG_OVERLAY:
        overlay = detection.draw_debug_overlay(image_bgr, cards)
        debug_name = f"{batch_id}_debug.jpg"
        _save_jpeg(overlay, config.CARDS_DIR / debug_name)
        debug_url = f"/cards/{debug_name}"

    return {"count": len(results), "cards": results, "debugUrl": debug_url}

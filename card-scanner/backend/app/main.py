"""
FastAPI application for the MTG card scanner.

Endpoints:
    GET  /health           -> liveness probe plus index size and OCR availability.
    GET  /api/index/stats  -> how many faces the identification index holds.
    POST /api/scan         -> accept an uploaded photo, detect & de-skew cards,
                              identify each, save the crops, return JSON.
    GET  /cards/...        -> static serving of the saved crops (StaticFiles mount).

De-skewed crops are written to ``config.CARDS_DIR`` and served back under the
``/cards`` URL prefix. In development a Vite proxy forwards ``/api`` and
``/cards`` to this server, so the frontend can use the relative URLs returned
here verbatim; CORS is also enabled so a phone or other direct client can call
the API straight.

Threading model: ``scan`` is a plain ``def`` so FastAPI runs it in its worker
threadpool — one to three seconds of OpenCV/ORB/OCR work must never sit on the
event loop (plan idea A24). Inside it, the per-crop identification of a
multi-card photo runs on a small ``ThreadPoolExecutor`` (``SCAN_WORKERS``);
OpenCV and onnxruntime release the GIL during their kernels, so two workers
roughly halve the wall time of a four-card scan without oversubscribing the CPU.
"""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config, detection, index_db, matcher, ocr, verify

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


app = FastAPI(title="MTG Card Scanner", version="0.2.0", lifespan=lifespan)

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
    """Liveness probe; also reports the index size and whether OCR is available.

    Both extra fields degrade gracefully: an unreachable database reads as an
    empty index and missing OCR models as ``ocr: false`` — the probe itself never
    fails because of them.
    """
    return {"status": "ok", "index": matcher.index_size(), "ocr": ocr.available()}


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


def _identify(card: detection.DetectedCard) -> matcher.IdentifyResult:
    """Identify one crop; a matcher failure is "no match", never a 500 for the scan."""
    try:
        return matcher.identify_card(card.image, ocr_image=card.ocr_image)
    except Exception as err:  # noqa: BLE001 — one bad crop must not lose the whole photo
        print(f"identification failed for a crop: {err}", flush=True)
        return matcher.IdentifyResult(matches=[])


@app.post("/api/scan")
def scan(image: UploadFile = File(...)) -> dict:
    """Detect, de-skew and identify the cards in an uploaded photo.

    Cards are identified *before* anything is saved: a detection the pHash
    verification could not clear is kept only if Stage 2 (ORB + RANSAC) finds at
    least ``VERIFY_MIN_INLIERS`` inliers for some indexed card (``verify.orb_gate``,
    plan idea A9); otherwise it is dropped with reason ``orb`` and never reaches
    the user. The saved crop is rotated to upright using the best orientation
    evidence available — the validated homography of the winning match, else
    the detector's hash variant.

    Args:
        image: A multipart file field named ``image`` (a JPEG/PNG photo).

    Returns:
        JSON of the form::

            {
              "count": <int>,
              "cards": [ { "id", "url", "width", "height", "matches",
                           "source", "detectScore", "hashDistance",
                           "orientation", "ocr" }, ... ],
              "debugUrl": "/cards/<batch>_debug.jpg" | null,
              "debug": { ... }            # only when DEBUG_JSON is on
            }

        ``orientation`` is the total rotation (0 or 180) applied to the
        geometric crop before saving; ``ocr`` is the matcher's OCR summary or
        ``null`` when OCR did not run.

    Raises:
        HTTPException: 400 for an empty or undecodable upload.
    """
    raw = image.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")

    try:
        image_bgr = detection.load_image_bgr(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result = detection.detect(image_bgr)

    # Identify every crop first (in parallel), then decide what to keep.
    cards = list(result.cards)
    if cards:
        with ThreadPoolExecutor(max_workers=max(1, config.SCAN_WORKERS)) as pool:
            idents = list(pool.map(_identify, cards))
    else:
        idents = []

    kept: list[tuple[detection.DetectedCard, matcher.IdentifyResult]] = []
    for card, ident in zip(cards, idents, strict=True):
        if not verify.orb_gate(card, ident.matches):
            result.drop(card, "orb")
            continue
        kept.append((card, ident))

    # A unique batch id ties this scan's crops + debug overlay together.
    batch_id = uuid.uuid4().hex

    results = []
    for index, (card, ident) in enumerate(kept):
        card_id = f"{batch_id}_{index}"
        filename = f"{card_id}.jpg"
        crop = card.image
        # The detector already rotated the crop by its hash variant; the matcher's
        # opinion is relative to that crop, so a 180 here flips it once more.
        extra = ident.orientation if ident.orientation is not None else 0
        if extra == 180:
            crop = cv2.rotate(crop, cv2.ROTATE_180)
        orientation = (int(card.orientation) + int(extra)) % 360
        _save_jpeg(crop, config.CARDS_DIR / filename)
        height, width = crop.shape[:2]
        results.append(
            {
                "id": card_id,
                "url": f"/cards/{filename}",
                "width": width,
                "height": height,
                "matches": ident.matches,
                "source": card.source,
                "detectScore": round(float(card.score), 3),
                "hashDistance": card.hash_distance,
                "orientation": orientation,
                "ocr": ident.ocr,
            }
        )

    # Optionally save an annotated copy of the original to aid CV tuning.
    debug_url = None
    if config.SAVE_DEBUG_OVERLAY:
        overlay = detection.draw_debug_overlay(image_bgr, result)
        debug_name = f"{batch_id}_debug.jpg"
        _save_jpeg(overlay, config.CARDS_DIR / debug_name)
        debug_url = f"/cards/{debug_name}"
        if config.DEBUG_SAVE_INTERMEDIATE:
            for name, img in result.debug_images.items():
                _save_jpeg(img, config.CARDS_DIR / f"{batch_id}_{name}.jpg")

    response: dict = {"count": len(results), "cards": results, "debugUrl": debug_url}
    if config.DEBUG_JSON:
        response["debug"] = {
            "candidates": result.n_candidates,
            "verifyMode": result.verify_mode,
            "workScale": round(result.work_scale, 4),
            "timingsMs": {k: round(v, 1) for k, v in result.timings_ms.items()},
            "rejected": result.rejected_json(config.DEBUG_MAX_REJECTED),
        }
    return response

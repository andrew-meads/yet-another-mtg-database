"""
OpenCV card-detection and de-skew pipeline.

Given a photo that may contain one or more Magic: The Gathering cards lying on a
contrasting surface, this module finds card-shaped quadrilaterals and
perspective-corrects ("de-skews") each into a flat, portrait, card-shaped image
suitable for display now and pHash identification later (Part 2).

Pipeline overview (see :func:`detect_and_deskew`)::

    decode (EXIF-aware)
      -> downscale a working copy            (speed / noise tolerance)
      -> grayscale -> blur -> Canny -> dilate (find the card OUTLINE)
      -> find contours -> keep convex 4-pt quads of plausible area
      -> for each quad: order corners -> four-point perspective warp
         (sampled from the FULL-resolution original for sharpness)
      -> normalize to portrait + standard card aspect ratio

The helpers :func:`order_points` and :func:`four_point_transform` follow the
well-known PyImageSearch "document scanner" approach, which is reliable for
non-overlapping cards against a contrasting background.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageOps

from . import config


@dataclass
class DetectedCard:
    """A single de-skewed card plus the source quad it came from.

    Attributes:
        image: The warped, portrait, BGR card crop (ready to encode/save).
        quad:  The four source corners in ORIGINAL full-res image coordinates,
               ordered TL, TR, BR, BL. Kept so callers can draw debug overlays.
    """

    image: np.ndarray
    quad: np.ndarray


def load_image_bgr(data: bytes) -> np.ndarray:
    """Decode raw upload bytes into an EXIF-corrected BGR image.

    Phones record orientation as an EXIF tag rather than physically rotating the
    pixels. OpenCV ignores EXIF, so a portrait phone photo would otherwise be
    processed sideways. We therefore decode with Pillow, apply
    :func:`PIL.ImageOps.exif_transpose` to bake the rotation into the pixels,
    then convert RGB -> BGR for OpenCV.

    Args:
        data: Raw bytes of an uploaded image (JPEG/PNG/...).

    Returns:
        An ``H x W x 3`` uint8 array in BGR channel order.

    Raises:
        ValueError: If the bytes cannot be decoded as an image.
    """
    try:
        with Image.open(io.BytesIO(data)) as pil_img:
            # Honour the EXIF orientation tag, then force 3-channel RGB (drops
            # any alpha/palette so the array shape is predictable).
            pil_img = ImageOps.exif_transpose(pil_img).convert("RGB")
            rgb = np.asarray(pil_img)
    except Exception as exc:  # Pillow raises various types on malformed input.
        raise ValueError("Could not decode uploaded image") from exc

    # PIL gives RGB; OpenCV works in BGR.
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def order_points(pts: np.ndarray) -> np.ndarray:
    """Order four points as top-left, top-right, bottom-right, bottom-left.

    Uses the classic coordinate sum/difference trick, which is unambiguous for a
    convex quadrilateral:

    * top-left      has the smallest ``x + y`` sum,
    * bottom-right  has the largest  ``x + y`` sum,
    * top-right     has the smallest ``y - x`` difference,
    * bottom-left   has the largest  ``y - x`` difference.

    Args:
        pts: A ``(4, 2)`` array of corner coordinates in any order.

    Returns:
        A ``(4, 2)`` float32 array ordered TL, TR, BR, BL.
    """
    rect = np.zeros((4, 2), dtype="float32")

    s = pts.sum(axis=1)             # x + y
    rect[0] = pts[np.argmin(s)]     # top-left
    rect[2] = pts[np.argmax(s)]     # bottom-right

    diff = np.diff(pts, axis=1)[:, 0]  # y - x
    rect[1] = pts[np.argmin(diff)]  # top-right
    rect[3] = pts[np.argmax(diff)]  # bottom-left

    return rect


def four_point_transform(image: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Perspective-warp the quadrilateral ``pts`` out of ``image`` into a rectangle.

    The destination size is the larger of each pair of opposing edges, so the
    warp neither stretches nor squashes the card relative to its largest apparent
    dimension.

    Args:
        image: Source image to sample from (full resolution for best detail).
        pts:   Four source corners (any order); reordered internally.

    Returns:
        The warped BGR rectangle.
    """
    rect = order_points(pts)
    (tl, tr, br, bl) = rect

    # Width = larger of the top/bottom edges; height = larger of the side edges.
    width = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    height = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    max_width = max(int(round(width)), 1)   # guard against degenerate quads
    max_height = max(int(round(height)), 1)

    # Destination corners in the same TL, TR, BR, BL order as ``rect``.
    dst = np.array(
        [
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ],
        dtype="float32",
    )

    matrix = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, matrix, (max_width, max_height))


def _normalize_to_card(warped: np.ndarray) -> np.ndarray:
    """Rotate to portrait and resize to the standard MTG card aspect ratio.

    A card photographed sideways yields a landscape warp; we rotate it 90° so
    every output is portrait, then resize to a fixed resolution so all crops
    share one size (convenient for Part-2 pHashing).

    NOTE: this does NOT correct 180° flips (upright vs upside-down) — that needs
    reading the card's title/art and is deferred to Part 2.

    Args:
        warped: The raw four-point-transform output.

    Returns:
        A ``OUTPUT_WIDTH x OUTPUT_HEIGHT`` portrait BGR crop.
    """
    h, w = warped.shape[:2]
    if w > h:
        # Landscape -> rotate 90° clockwise to portrait.
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)

    # INTER_AREA gives the best quality when shrinking.
    return cv2.resize(
        warped, (config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT), interpolation=cv2.INTER_AREA
    )


def detect_and_deskew(image_bgr: np.ndarray) -> list[DetectedCard]:
    """Find card quadrilaterals in ``image_bgr`` and return de-skewed crops.

    Args:
        image_bgr: Full-resolution source image (BGR).

    Returns:
        One :class:`DetectedCard` per detected card; empty if none found.
    """
    orig = image_bgr
    orig_h, orig_w = orig.shape[:2]

    # --- 1. Downscale a working copy for fast, noise-tolerant edge finding. ---
    long_edge = max(orig_h, orig_w)
    scale = config.WORK_LONG_EDGE / long_edge if long_edge > config.WORK_LONG_EDGE else 1.0
    if scale < 1.0:
        work = cv2.resize(
            orig, (round(orig_w * scale), round(orig_h * scale)), interpolation=cv2.INTER_AREA
        )
    else:
        work = orig
    inv_scale = 1.0 / scale  # maps working-image coords back to the original

    # --- 2. Build an edge map: grayscale -> blur -> Canny -> dilate. ---
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    # Gaussian blur suppresses sensor noise and card-art texture so Canny locks
    # onto the strong card *outline* rather than interior detail.
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, config.CANNY_LOW, config.CANNY_HIGH)
    # Dilation thickens and bridges small gaps so the outline forms a single
    # closed contour even where an edge is faint.
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    # --- 3. Find external contours and keep card-like quads. ---
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    work_area = work.shape[0] * work.shape[1]
    min_area = work_area * config.MIN_AREA_RATIO
    max_area = work_area * config.MAX_AREA_RATIO

    cards: list[DetectedCard] = []
    # Largest first: real cards dominate the frame, noise is small.
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(contour)
        if area < min_area or area > max_area:
            continue

        # Approximate the contour by a polygon; a card collapses to four corners.
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, config.APPROX_EPSILON_RATIO * perimeter, True)

        # Keep only convex quadrilaterals: a flat card shot from a sensible angle
        # stays convex; concave 4-gons are almost always detection artifacts.
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue

        # Map corners from working-image space back to the full-res original so
        # the warp samples maximum detail.
        quad = approx.reshape(4, 2).astype("float32") * inv_scale

        warped = four_point_transform(orig, quad)
        normalized = _normalize_to_card(warped)
        cards.append(DetectedCard(image=normalized, quad=order_points(quad)))

    return cards


def draw_debug_overlay(image_bgr: np.ndarray, cards: list[DetectedCard]) -> np.ndarray:
    """Return a copy of ``image_bgr`` with each detected card's quad outlined.

    Handy for eyeballing what the detector locked onto while tuning thresholds.

    Args:
        image_bgr: The original full-res frame.
        cards:     Detections from :func:`detect_and_deskew`.

    Returns:
        An annotated BGR copy (the input is not modified).
    """
    overlay = image_bgr.copy()
    # Scale line/text size with the image so overlays read on big phone photos.
    thickness = max(2, image_bgr.shape[0] // 300)
    for i, card in enumerate(cards, start=1):
        pts = card.quad.astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(overlay, [pts], isClosed=True, color=(0, 255, 0), thickness=thickness)
        # Label near the top-left corner of the quad.
        tl = tuple(card.quad[0].astype(int))
        cv2.putText(
            overlay, f"#{i}", tl, cv2.FONT_HERSHEY_SIMPLEX, thickness * 0.7,
            (0, 255, 0), thickness,
        )
    return overlay

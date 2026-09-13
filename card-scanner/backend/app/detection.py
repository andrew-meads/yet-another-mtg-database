"""
OpenCV card-detection and de-skew pipeline.

Given a photo that may contain one or more Magic: The Gathering cards lying on
some surface, this module finds card-shaped quadrilaterals and
perspective-corrects ("de-skews") each into a flat, portrait, card-shaped crop
suitable for display and for pHash/ORB/OCR identification (:mod:`app.matcher`).

The original detector was a single strategy (grey → Canny 75/200 → dilate →
external contours → convex 4-gons) and only worked on white paper: a black
border on a dark table has no luminance edge, a textured surface floods the
edge map so the card is never the *outer* contour, and rounded or touching
corners break the 4-point assumption. The pipeline is now a funnel — many
cheap hypotheses in, a few verified cards out::

    decode (EXIF-aware)
      -> downscale a working copy                    (speed / noise tolerance)
      -> strategies: edge sweep + colour-mask model  (app.candidates)
      -> grid split of n x m-shaped candidates       (touching cards)
      -> geometric filters + score                   (reason codes)
      -> dedup, pHash verification                   (app.verify: index decides)
      -> NMS across strategies, caps
      -> for each survivor, at FULL resolution:
           refine corners -> single-resample warp -> rotate by orientation

Every stage records why it dropped a candidate; :func:`draw_debug_overlay`
draws the rejections by reason, which is how a new surface gets tuned.
:func:`detect` returns the full :class:`DetectionResult`;
:func:`detect_and_deskew` keeps the original list-of-cards signature.

The helpers :func:`order_points` and :func:`four_point_transform` live in
:mod:`app.geometry` and are re-exported here for older imports.
"""

from __future__ import annotations

import io
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image, ImageOps

from . import candidates as cands_mod
from . import config, matcher
from . import verify as verify_mod
from .candidates import Candidate, StrategyOutput
from .geometry import (
    four_point_transform,
    order_points,
    portrait_quad,
    refine_corners,
    warp_to_card,
)

__all__ = [
    "DetectedCard",
    "DetectionResult",
    "detect",
    "detect_and_deskew",
    "draw_debug_overlay",
    "four_point_transform",
    "load_image_bgr",
    "order_points",
]


@dataclass
class DetectedCard:
    """A single de-skewed card plus the source quad it came from.

    The first two fields keep their original order so positional construction
    (``DetectedCard(image, quad)``) still works; everything after has a default.

    Attributes:
        image: The warped, portrait, BGR card crop (``OUTPUT_HEIGHT x OUTPUT_WIDTH``),
            already rotated by ``orientation`` so it is upright as far as the
            detector can tell.
        quad: The four source corners in ORIGINAL full-res image coordinates,
            ordered TL, TR, BR, BL (geometric order — how the card lies in the
            photo, not its printed orientation).
        ocr_image: The 2x-oversampled portrait warp the crop was reduced from
            (capped at ``OCR_MAX_HEIGHT`` rows), rotated like ``image``; the OCR
            band passes read the collector line from it. ``None`` only for
            cards constructed by hand.
        source: Strategy that found it (``edges`` / ``color`` / ``color+`` / ``split``).
        score: Geometric score in ``[0, 1]`` (aspect fit, rectangularity, edge support).
        hash_distance: Minimum Hamming distance to the index, when verified.
        orientation: Rotation (0 or 180) applied to the crop, from the hash variant.
        verify: ``accepted`` / ``ambiguous`` / ``unverified`` (see :mod:`app.verify`).
    """

    image: np.ndarray
    quad: np.ndarray
    ocr_image: np.ndarray | None = None
    source: str = "edges"
    score: float = 0.0
    hash_distance: int | None = None
    orientation: int = 0
    verify: str = "unverified"


@dataclass
class DetectionResult:
    """Everything :func:`detect` learnt about one photo.

    Attributes:
        cards: The surviving cards, best first.
        rejected: Every candidate that did not survive, with its reason. Quads
            are in *working-image* coordinates; multiply by ``1 / work_scale``
            for the original frame (``to_json`` does that for you).
        work_scale: Working-image size / original size (``<= 1``).
        timings_ms: Per-stage wall-clock times.
        n_candidates: Total candidates considered (alive + rejected).
        verify_mode: The effective verification mode that ran.
        debug_images: Intermediate maps at working resolution (``edges``, ``mask``)
            for ``DEBUG_SAVE_INTERMEDIATE``.
    """

    cards: list[DetectedCard]
    rejected: list[Candidate]
    work_scale: float
    timings_ms: dict[str, float]
    n_candidates: int = 0
    verify_mode: str = "off"
    debug_images: dict[str, np.ndarray] = field(default_factory=dict)

    def drop(self, card: DetectedCard, reason: str) -> None:
        """Move a card into ``rejected`` (used by main.py's post-identification gate)."""
        self.cards = [c for c in self.cards if c is not card]
        self.rejected.append(
            Candidate(
                quad=order_points(card.quad) * self.work_scale,
                source=card.source,
                score=card.score,
                rejected=reason,
                orientation=card.orientation,
                hash_distance=card.hash_distance,
                verify=card.verify,
            )
        )

    def rejected_json(self, limit: int | None = None) -> list[dict]:
        """Rejected candidates in full-res coordinates, most interesting first."""
        ordered = _rank_rejected(self.rejected)
        if limit is not None:
            ordered = ordered[:limit]
        return [c.to_json(1.0 / self.work_scale) for c in ordered]


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


def _normalize_to_card(warped: np.ndarray) -> np.ndarray:
    """Rotate a raw warp to portrait and resize it to the standard card size.

    Kept for callers that already hold a natural-size warp (the harness's crop
    entries). The detector itself uses :func:`app.geometry.warp_to_card`, which
    produces the same portrait orientation with a single resample.

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


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def _downscale(image: np.ndarray, long_edge: int) -> tuple[np.ndarray, float]:
    """Working copy with the given long edge (never upscaled) and its scale factor."""
    h, w = image.shape[:2]
    current = max(h, w)
    if current <= long_edge:
        return image, 1.0
    scale = long_edge / current
    work = cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return work, scale


def _run_strategies(work: np.ndarray, timings: dict[str, float], tag: str) -> list[StrategyOutput]:
    """Run every strategy in ``DETECT_STRATEGIES`` on one working image."""
    outputs: list[StrategyOutput] = []
    for name in config.DETECT_STRATEGIES:
        t0 = time.perf_counter()
        if name == "edges":
            outputs.append(cands_mod.edge_candidates(work))
        elif name == "color":
            outputs.append(cands_mod.color_mask_candidates(work))
        else:
            continue  # unknown strategy names are ignored, not fatal
        timings[f"{name}{tag}"] = (time.perf_counter() - t0) * 1000.0
    return outputs


def _index_available() -> bool:  # pragma: no cover - kept for callers/tests
    """Whether the hash index has at least one face (never raises)."""
    try:
        return matcher.index_size() > 0
    except Exception:  # noqa: BLE001 — DB trouble means "no index", not an error
        return False


def detect(image_bgr: np.ndarray, *, verify: bool = True) -> DetectionResult:
    """Find the cards in ``image_bgr`` and return crops plus every rejected candidate.

    Args:
        image_bgr: Full-resolution source image (BGR).
        verify: Run the pHash verification (``False`` forces ``verify_mode="off"``,
            useful for measuring the geometric stages alone).

    Returns:
        A :class:`DetectionResult`; ``cards`` is empty when nothing card-like was found.
    """
    timings: dict[str, float] = {}
    t_start = time.perf_counter()
    orig = image_bgr

    # --- 1. Working copies. The first scale is the primary one: verification,
    # NMS and the debug maps live in its coordinate space. ---
    scales = tuple(config.WORK_LONG_EDGES) or (config.WORK_LONG_EDGE,)
    work, work_scale = _downscale(orig, scales[0])
    timings["downscale"] = (time.perf_counter() - t_start) * 1000.0

    # Resolving the mode touches the hash index; on a cold process that is the
    # one-off load of the whole table (~0.7 s for 115k faces), so it gets its
    # own timing bucket rather than silently inflating a strategy's.
    t0 = time.perf_counter()
    mode = verify_mod.effective_mode() if verify else "off"
    timings["index"] = (time.perf_counter() - t0) * 1000.0

    # --- 2. Strategies at every scale; candidates mapped to primary coords. ---
    all_cands: list[Candidate] = []
    support_primary: np.ndarray | None = None
    debug_images: dict[str, np.ndarray] = {}
    for scale_idx, long_edge in enumerate(scales):
        if scale_idx == 0:
            w_img, s = work, work_scale
        else:
            w_img, s = _downscale(orig, long_edge)
        tag = "" if scale_idx == 0 else f"@{long_edge}"
        outputs = _run_strategies(w_img, timings, tag)
        if not outputs:
            continue
        support = outputs[0].support.copy()
        for out in outputs[1:]:
            support |= out.support
        cands = [c for out in outputs for c in out.candidates]

        # --- 3. Grid split of merged/touching cards (A14). ---
        if config.SPLIT_TOUCHING:
            children: list[Candidate] = []
            for c in cands:
                children.extend(cands_mod.split_merged(c, support))
            cands.extend(children)

        # --- 4. Geometric filters + score, at this scale's resolution. ---
        t0 = time.perf_counter()
        cands_mod.filter_candidates(cands, w_img.shape, support)
        timings[f"filter{tag}"] = (time.perf_counter() - t0) * 1000.0

        factor = work_scale / s
        if factor != 1.0:
            for c in cands:
                c.quad = c.quad * factor
                c.metrics.pop("area", None)
                c.params["scale"] = long_edge
        all_cands.extend(cands)
        if scale_idx == 0:
            support_primary = support
            for out in outputs:
                debug_images.update(out.debug)

    # --- 5. Dedup across strategies/scales, then hash verification. ---
    t0 = time.perf_counter()
    alive = cands_mod.dedup(all_cands)
    if verify and mode != "off":
        mode = verify_mod.hash_verify(alive, work, mode=mode)
    timings["verify"] = (time.perf_counter() - t0) * 1000.0

    # --- 6. Containers out, children of a surviving parent out, NMS, then the caps. ---
    t0 = time.perf_counter()
    cands_mod.reject_containers(all_cands)
    cands_mod.prune_split_children(all_cands)
    winners = cands_mod.nms(all_cands)
    final: list[Candidate] = []
    n_ambiguous = 0
    for c in winners:
        if c.verify == "ambiguous":
            n_ambiguous += 1
            if n_ambiguous > config.MAX_AMBIGUOUS:
                c.rejected = "ambiguous-cap"
                continue
        if len(final) >= config.MAX_CARDS:
            c.rejected = "max-cards"
            continue
        final.append(c)
    timings["nms"] = (time.perf_counter() - t0) * 1000.0

    # --- 7. Full resolution: refine corners, warp once, rotate by orientation. ---
    t0 = time.perf_counter()
    inv_scale = 1.0 / work_scale
    cards: list[DetectedCard] = []
    for c in final:
        quad_full = order_points(c.quad * inv_scale)
        if config.REFINE_CORNERS:
            refined = refine_corners(
                orig,
                quad_full,
                band_in_ratio=config.REFINE_BAND_IN,
                band_out_ratio=config.REFINE_BAND_OUT,
                samples=config.REFINE_SAMPLES,
            )
            c.metrics["refine_px"] = float(np.linalg.norm(refined - quad_full, axis=1).max())
            quad_full = refined
        crop, hires = warp_to_card(
            orig,
            quad_full,
            config.OUTPUT_WIDTH,
            config.OUTPUT_HEIGHT,
            oversample=2,
            max_hires_height=config.OCR_MAX_HEIGHT,
        )
        orientation = int(c.orientation or 0)
        if orientation == 180:
            crop = cv2.rotate(crop, cv2.ROTATE_180)
            hires = cv2.rotate(hires, cv2.ROTATE_180)
        cards.append(
            DetectedCard(
                image=crop,
                quad=quad_full,
                ocr_image=hires,
                source=c.source,
                score=float(c.score),
                hash_distance=c.hash_distance,
                orientation=orientation,
                verify=c.verify,
            )
        )
    timings["warp"] = (time.perf_counter() - t0) * 1000.0
    timings["total"] = (time.perf_counter() - t_start) * 1000.0

    if support_primary is not None and "edges" not in debug_images:
        debug_images["edges"] = support_primary
    return DetectionResult(
        cards=cards,
        rejected=[c for c in all_cands if not c.alive],
        work_scale=work_scale,
        timings_ms=timings,
        n_candidates=len(all_cands),
        verify_mode=mode if verify else "off",
        debug_images=debug_images,
    )


def detect_and_deskew(image_bgr: np.ndarray) -> list[DetectedCard]:
    """Find card quadrilaterals in ``image_bgr`` and return de-skewed crops.

    Thin wrapper over :func:`detect` that keeps the original signature.

    Args:
        image_bgr: Full-resolution source image (BGR).

    Returns:
        One :class:`DetectedCard` per detected card; empty if none found.
    """
    return detect(image_bgr).cards


# ---------------------------------------------------------------------------
# Debug overlay
# ---------------------------------------------------------------------------

# BGR colours per rejection reason (the legend uses the same table). Reasons not
# listed (e.g. "nms:3") are looked up by their prefix before the colon.
_REASON_COLOURS: dict[str, tuple[int, int, int]] = {
    "area": (128, 128, 128),
    "concave": (160, 160, 90),
    "angles": (0, 165, 255),
    "aspect": (0, 200, 255),
    "rect": (255, 0, 255),
    "edge_support": (200, 0, 120),
    "dup": (90, 90, 90),
    "hash": (0, 0, 255),
    "nms": (255, 180, 0),
    "container": (255, 100, 200),
    "ambiguous-cap": (0, 80, 255),
    "max-cards": (0, 80, 255),
    "orb": (60, 60, 255),
}

# How interesting a rejection is for a human tuning the detector: the further
# down the funnel a candidate got, the more it says about a near-miss.
_REASON_PRIORITY = [
    "orb",
    "ambiguous-cap",
    "max-cards",
    "nms",
    "container",
    "hash",
    "edge_support",
    "rect",
    "aspect",
    "angles",
    "concave",
    "area",
    "dup",
]


def _reason_key(reason: str | None) -> str:
    return (reason or "").split(":", 1)[0]


def _rank_rejected(rejected: list[Candidate]) -> list[Candidate]:
    """Rejected candidates ordered by how close they came to being accepted."""
    rank = {r: i for i, r in enumerate(_REASON_PRIORITY)}
    return sorted(
        rejected,
        key=lambda c: (rank.get(_reason_key(c.rejected), len(rank)), -c.score, -c.area),
    )


def _label(overlay: np.ndarray, text: str, org: tuple[int, int], colour, scale: float, thick: int):
    """Text with a dark outline so it reads on any surface."""
    cv2.putText(overlay, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), thick + 2)
    cv2.putText(overlay, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, colour, thick)


def draw_debug_overlay(
    image_bgr: np.ndarray, result: DetectionResult | list[DetectedCard]
) -> np.ndarray:
    """Return a copy of ``image_bgr`` annotated with the detection outcome.

    Accepted cards are outlined in green with ``#i <source> d=<hash> s=<score>``
    and a filled circle on the edge that is the card's *printed top* (after the
    orientation the detector applied). When given a full
    :class:`DetectionResult` and ``DEBUG_OVERLAY_REJECTED`` is on, the most
    interesting ``DEBUG_MAX_REJECTED`` rejected candidates are drawn thinner,
    coloured by reason, with a legend (reason → colour → count) and the stage
    timings in the top-left corner.

    Args:
        image_bgr: The original full-res frame.
        result: A :class:`DetectionResult`, or a plain list of cards.

    Returns:
        An annotated BGR copy (the input is not modified).
    """
    overlay = image_bgr.copy()
    if isinstance(result, DetectionResult):
        cards = result.cards
        rejected = result.rejected
        inv_scale = 1.0 / result.work_scale
        timings = result.timings_ms
    else:
        cards, rejected, inv_scale, timings = list(result), [], 1.0, {}

    # Scale line/text size with the image so overlays read on big phone photos.
    thickness = max(2, image_bgr.shape[0] // 300)
    font_scale = thickness * 0.5

    if config.DEBUG_OVERLAY_REJECTED and rejected:
        counts: dict[str, int] = {}
        for c in rejected:
            key = _reason_key(c.rejected)
            counts[key] = counts.get(key, 0) + 1
        for c in _rank_rejected(rejected)[: config.DEBUG_MAX_REJECTED]:
            key = _reason_key(c.rejected)
            colour = _REASON_COLOURS.get(key, (200, 200, 200))
            pts = np.rint(c.quad * inv_scale).astype(np.int32).reshape(-1, 1, 2)
            cv2.polylines(overlay, [pts], True, colour, max(1, thickness // 2))
            tag = c.rejected or "?"
            if c.hash_distance is not None:
                tag += f" d={c.hash_distance}"
            tl = tuple(int(v) for v in pts[0, 0])
            _label(
                overlay, tag, (tl[0], tl[1] - 4), colour, font_scale * 0.6, max(1, thickness // 2)
            )

        # Legend + timings block in the top-left corner.
        line_h = int(28 * font_scale)
        y = line_h
        for key in _REASON_PRIORITY:
            if key not in counts:
                continue
            colour = _REASON_COLOURS.get(key, (200, 200, 200))
            cv2.rectangle(overlay, (10, y - line_h + 6), (10 + line_h - 8, y), colour, -1)
            _label(
                overlay, f"{key}: {counts[key]}", (10 + line_h, y - 4), colour, font_scale * 0.7, 1
            )
            y += line_h
        if timings:
            parts = [f"{k} {v:.0f}" for k, v in timings.items() if k != "total"]
            _label(
                overlay,
                f"ms: total {timings.get('total', 0):.0f} | " + " ".join(parts),
                (10, y),
                (255, 255, 255),
                font_scale * 0.6,
                1,
            )

    for i, card in enumerate(cards, start=1):
        quad = order_points(card.quad)
        pts = quad.astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(overlay, [pts], isClosed=True, color=(0, 255, 0), thickness=thickness)
        text = f"#{i} {card.source}"
        if card.hash_distance is not None:
            text += f" d={card.hash_distance}"
        text += f" s={card.score:.2f}"
        tl = tuple(quad[0].astype(int))
        _label(overlay, text, (tl[0], tl[1] - 6), (0, 255, 0), font_scale, thickness)
        # Orientation marker: the crop's top edge is portrait_quad()[0..1]; if the
        # detector rotated the crop by 180, the printed top is the opposite edge.
        pq = portrait_quad(quad)
        top = (pq[0] + pq[1]) / 2.0 if card.orientation != 180 else (pq[2] + pq[3]) / 2.0
        cv2.circle(overlay, tuple(int(v) for v in top), thickness * 3, (0, 255, 0), -1)
    return overlay

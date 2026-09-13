"""
Candidate quads for the card detector: strategies, geometric filters, NMS.

The detector (:mod:`app.detection`) no longer trusts one edge map. It gathers
*candidate* quads from several cheap classical strategies, each of which is
good at a surface the others are bad at, and then lets geometry, the pHash
index (:mod:`app.verify`) and non-maximum suppression decide which candidates
are cards. This module owns everything up to and including that decision,
apart from the hash lookup itself:

* :class:`Candidate` — a quad in *working-image* coordinates plus everything
  we learn about it (where it came from, its metrics, why it was rejected).
  Rejected candidates are kept, not discarded: the debug overlay draws them
  coloured by reason, and the rejection histogram is how a new surface gets
  tuned.
* :func:`edge_candidates` — the bounded multi-channel Canny sweep (ideas
  A1–A5 of the plan). Blur size × auto-Canny sigma × channel combination ×
  morphology, ``RETR_LIST`` contours, robust quad extraction.
* :func:`color_mask_candidates` — the background-colour model (A10) for
  uniform non-white surfaces, where a black card border has no edge against a
  dark table but the printed frame still has colour.
* :func:`split_merged` — grid split of a candidate shaped like ``n × m``
  touching cards (A14).
* :func:`filter_candidates` — geometric filters with reason codes and the
  candidate score (A6).
* :func:`nms` — IoU + containment suppression across strategies (A7).

Every threshold comes from :mod:`app.config`; nothing here does I/O.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from . import config
from .geometry import (
    containment,
    interior_angles,
    order_points,
    quad_area,
    quad_aspect,
    quad_from_contour,
    quad_iou,
)

# Ordering of verification outcomes for NMS: a hash-verified quad always beats
# an unverified twin of itself (the inset colour-mask quad vs its expanded twin,
# the outer vs inner ring contour of a thick edge, ...).
VERIFY_RANK = {"accepted": 0, "ambiguous": 1, "unverified": 2, "rejected": 3}

# Reason codes filter_candidates / nms / split_merged can assign, in the order the
# overlay legend lists them. Verification adds "hash"; main.py adds "orb".
REASONS = (
    "area",
    "concave",
    "angles",
    "aspect",
    "rect",
    "edge_support",
    "dup",
    "hash",
    "nms",
    "split",
    "ambiguous-cap",
    "max-cards",
    "orb",
)

# Grid shapes split_merged recognises, as (columns, rows) of *portrait* cards.
# (1, 1) is a single card and is never split, and no square grid is listed: an
# n x n grid of cards has exactly one card's proportions, so aspect can never
# tell them apart and a split would tile every ordinary card into junk. The
# transposed layouts (cards lying sideways) come for free because both card
# orientations are tried.
GRID_SHAPES = ((2, 1), (3, 1), (4, 1), (1, 2), (1, 3), (1, 4), (3, 2), (2, 3), (4, 2), (2, 4))


@dataclass
class Candidate:
    """One quad hypothesis in working-image coordinates.

    Attributes:
        quad: ``(4, 2)`` float32, ordered TL, TR, BR, BL (geometric order).
        source: Strategy that produced it: ``edges``, ``color``, ``color+``
            (the border-expanded twin) or ``split``.
        params: Sweep parameters that produced it (blur, sigma, channels, morph,
            ...). Purely informational; shown in the debug JSON.
        metrics: Measured properties (``contour_area``, ``area``, ``aspect``,
            ``rectangularity``, ``max_angle_dev``, ``edge_support``, ``min_side``).
            A strategy may pre-set a metric it knows better than the filter can
            measure (the expanded twin inherits its parent's edge support).
        score: ``0.4·aspect_fit + 0.3·rectangularity + 0.3·edge_support`` once
            filtered; 0 before.
        rejected: ``None`` while alive, else a reason code (see :data:`REASONS`;
            ``nms:<k>`` names the surviving card that suppressed it).
        orientation: 0 or 180 — the hash variant that matched best, when
            verified; ``None`` otherwise.
        hash_distance: Minimum Hamming distance to the index, when verified.
        verify: ``accepted`` / ``ambiguous`` / ``unverified`` / ``rejected``.
        parent: For ``split`` children, the candidate they were tiled from.
    """

    quad: np.ndarray
    source: str
    params: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    score: float = 0.0
    rejected: str | None = None
    orientation: int | None = None
    hash_distance: int | None = None
    verify: str = "unverified"
    parent: Candidate | None = field(default=None, repr=False, compare=False)

    @property
    def alive(self) -> bool:
        """Whether no stage has rejected this candidate yet."""
        return self.rejected is None

    @property
    def area(self) -> float:
        """Quad area in working-image px² (cached in ``metrics``)."""
        if "area" not in self.metrics:
            self.metrics["area"] = quad_area(self.quad)
        return float(self.metrics["area"])

    def sort_key(self) -> tuple:
        """NMS priority: verified > ambiguous > unverified, then hash distance, then
        (unverified only) sweep consensus, then score before area for verified
        candidates and area before score otherwise.

        Area comes before the geometric score for *unverified* candidates on
        purpose: without an index the art box or inner frame of a card often
        scores a little *higher* than the card itself (a cleaner rectangle, no
        rounded corners). Largest-first lets the outer quad win and the
        containment rule then removes everything nested inside it — the same
        outermost-contour prior the original detector had. Once the index has
        spoken, nested junk is already behind on hash distance, and the
        remaining ties are between near-identical quads of the *same* card
        (a sleeved card: the sleeve outline and the card outline hash the
        same), where the better-supported, better-proportioned one is right.
        """
        distance = self.hash_distance if self.hash_distance is not None else 999
        tier = VERIFY_RANK.get(self.verify, 9)
        # The border-expanded twin has no boundary evidence of its own (it
        # inherits its parent's); it exists for the hash to arbitrate, so
        # without a hash distance it ranks behind every ordinary candidate.
        if self.source == "color+" and self.hash_distance is None:
            tier += 0.5
        if self.verify in ("accepted", "ambiguous"):
            return (tier, distance, 0, -self.score, -self.area)
        # Consensus first: a quad that several sweep passes re-found (a card
        # outline is found by nearly every blur/sigma/channel/morph combination,
        # ~30 of 32 passes) beats one that a single pass produced (a card plus a
        # tile line or a shadow, or a colour-mask blob, which is found once).
        consensus = 0 if self.metrics.get("hits", 1) >= config.NMS_CONSENSUS_HITS else 1
        if config.NMS_UNVERIFIED_ORDER == "score":
            return (tier, distance, consensus, -self.score, -self.area)
        return (tier, distance, consensus, -self.area, -self.score)

    def to_json(self, scale: float = 1.0) -> dict:
        """JSON-ready summary; ``scale`` maps the quad to another coordinate space."""
        out = {
            "quad": np.rint(self.quad * scale).astype(int).tolist(),
            "source": self.source,
            "score": round(float(self.score), 3),
            "verify": self.verify,
            "hashDistance": self.hash_distance,
            "orientation": self.orientation,
            "rejected": self.rejected,
        }
        if self.params:
            out["params"] = dict(self.params)
        if self.metrics:
            out["metrics"] = {k: round(float(v), 3) for k, v in self.metrics.items()}
        return out


@dataclass
class StrategyOutput:
    """What a strategy returns: its candidates plus the evidence map behind them.

    ``support`` is a binary ``uint8`` map at working resolution marking pixels
    where the strategy saw a boundary (edge pixels, or the colour-mask outline).
    The filter's *edge support* metric samples it along each quad's perimeter.
    ``debug`` holds intermediate images for ``DEBUG_SAVE_INTERMEDIATE``.
    """

    candidates: list[Candidate]
    support: np.ndarray
    debug: dict[str, np.ndarray] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _bbox(quad: np.ndarray) -> np.ndarray:
    """Axis-aligned ``[x0, y0, x1, y1]`` of a quad."""
    return np.array(
        [quad[:, 0].min(), quad[:, 1].min(), quad[:, 0].max(), quad[:, 1].max()], dtype=np.float32
    )


def _bbox_iou(box: np.ndarray, boxes: np.ndarray) -> np.ndarray:
    """IoU of one axis-aligned box against an ``(N, 4)`` array of boxes."""
    if len(boxes) == 0:
        return np.empty(0, dtype=np.float32)
    ix0 = np.maximum(box[0], boxes[:, 0])
    iy0 = np.maximum(box[1], boxes[:, 1])
    ix1 = np.minimum(box[2], boxes[:, 2])
    iy1 = np.minimum(box[3], boxes[:, 3])
    inter = np.clip(ix1 - ix0, 0, None) * np.clip(iy1 - iy0, 0, None)
    area_a = (box[2] - box[0]) * (box[3] - box[1])
    area_b = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    union = area_a + area_b - inter
    return np.where(union > 0, inter / np.maximum(union, 1e-9), 0.0)


class _Deduper:
    """Incremental near-duplicate filter for quads.

    Exact quad IoU (``cv2.intersectConvexConvex``) against every earlier quad is
    quadratic and, with a few hundred candidates from a busy edge map, would cost
    more than the sweep itself. The axis-aligned bounding-box IoU is a cheap
    upper bound on the quad IoU, so only pairs whose boxes overlap well are
    checked exactly.
    """

    def __init__(self, iou_threshold: float) -> None:
        self.iou_threshold = iou_threshold
        self.quads: list[np.ndarray] = []
        self.boxes: list[np.ndarray] = []

    def find(self, quad: np.ndarray) -> int | None:
        """Index of an earlier quad with IoU >= threshold, or ``None``."""
        box = _bbox(quad)
        if self.boxes:
            ious = _bbox_iou(box, np.asarray(self.boxes))
            for k in np.flatnonzero(ious >= self.iou_threshold):
                if quad_iou(quad, self.quads[k]) >= self.iou_threshold:
                    return int(k)
        return None

    def add(self, quad: np.ndarray) -> None:
        self.quads.append(quad)
        self.boxes.append(_bbox(quad))


def support_distance(support: np.ndarray) -> np.ndarray:
    """Distance (px) from every pixel to the nearest non-zero pixel of ``support``.

    One ``cv2.distanceTransform`` per support map (~3 ms at 1000 px) lets
    :func:`edge_support` be evaluated with a per-candidate tolerance without
    dilating the map once per candidate.
    """
    return cv2.distanceTransform((support == 0).astype(np.uint8), cv2.DIST_L2, 3)


def edge_support(
    quad: np.ndarray,
    support: np.ndarray,
    samples: int = 200,
    *,
    tolerance_px: float | None = None,
    distance: np.ndarray | None = None,
) -> float:
    """Fraction of ``samples`` points along the quad's perimeter that lie on ``support``.

    ``support`` is a binary map (edge pixels or mask outline). A point counts
    when it is within ``tolerance_px`` of a support pixel — by default 1 % of
    the quad's long edge, at least 2 px. The tolerance must scale with the
    quad: the polygon approximation that produced it (``approxPolyDP`` at
    2–5 % of the perimeter) legitimately runs a few pixels off the contour
    along a side, which refinement fixes later, whereas a quad hallucinated by
    intersecting two long edges of *different* objects has sides that cross
    empty space by tens of pixels and is what this metric must catch. Pass
    ``distance`` (from :func:`support_distance`) to reuse one transform across
    many candidates.
    """
    h, w = support.shape[:2]
    q = np.asarray(quad, dtype=np.float64)
    per_side = max(samples // 4, 2)
    pts = []
    sides = []
    for k in range(4):
        a, b = q[k], q[(k + 1) % 4]
        sides.append(float(np.linalg.norm(b - a)))
        t = np.linspace(0.0, 1.0, per_side, endpoint=False)
        pts.append(a[None, :] + t[:, None] * (b - a)[None, :])
    pts_arr = np.concatenate(pts)
    xs = np.clip(np.rint(pts_arr[:, 0]).astype(int), 0, w - 1)
    ys = np.clip(np.rint(pts_arr[:, 1]).astype(int), 0, h - 1)
    if tolerance_px is None:
        tolerance_px = max(2.0, config.EDGE_SUPPORT_TOLERANCE * max(sides))
    if distance is None:
        distance = support_distance(support)
    hits = distance[ys, xs] <= tolerance_px
    return float(hits.mean()) if len(hits) else 0.0


def _area_bounds(work_shape: tuple[int, ...]) -> tuple[float, float]:
    """``(min_area, max_area)`` in working px² from the config ratios."""
    work_area = float(work_shape[0] * work_shape[1])
    return work_area * config.MIN_AREA_RATIO, work_area * config.MAX_AREA_RATIO


def _contours_to_candidates(
    binary: np.ndarray,
    source: str,
    params: dict,
    bounds: tuple[float, float],
    deduper: _Deduper,
    out: list[Candidate],
    *,
    mode: int,
) -> None:
    """Find contours in ``binary``, extract quads, append new ones to ``out``.

    Contours are visited largest first and capped at
    ``MAX_CANDIDATES_PER_STRATEGY`` *per pass*, so the interesting (big) shapes
    are always considered and a busy map cannot explode the candidate list. A
    quad that near-duplicates an earlier one (any pass) is not added again; the
    earlier one just records another hit.
    """
    min_area, max_area = bounds
    contours, _ = cv2.findContours(binary, mode, cv2.CHAIN_APPROX_SIMPLE)
    areas = [cv2.contourArea(c) for c in contours]
    order = sorted(range(len(contours)), key=lambda i: -areas[i])
    taken = 0
    for i in order:
        area = areas[i]
        if area > max_area:
            continue
        if area < min_area:
            break  # sorted descending: everything after this is smaller
        if taken >= config.MAX_CANDIDATES_PER_STRATEGY:
            break
        quad = quad_from_contour(
            contours[i], config.APPROX_EPSILONS, min_box_fill=config.MIN_RECTANGULARITY_BOX
        )
        if quad is None:
            continue
        quad = order_points(quad)
        taken += 1
        existing = deduper.find(quad)
        if existing is not None:
            out[existing].metrics["hits"] = out[existing].metrics.get("hits", 1) + 1
            continue
        deduper.add(quad)
        # An outline with a gap (glare, a finger, a shadow merging into the
        # border) is not a closed ring, so findContours traces *around* the
        # thin line: a contour whose perimeter is about twice its hull's and
        # whose area is a sliver. Its hull is still the card, so it is flagged
        # and the fill filter is skipped for it (see filter_candidates).
        hull = cv2.convexHull(contours[i])
        hull_perimeter = cv2.arcLength(hull, True)
        ring_like = (
            hull_perimeter > 0
            and cv2.arcLength(contours[i], True) > 1.5 * hull_perimeter
            and area < 0.5 * cv2.contourArea(hull)
        )
        out.append(
            Candidate(
                quad=quad,
                source=source,
                params=dict(params),
                metrics={"contour_area": float(area), "hits": 1, "ring": float(ring_like)},
            )
        )


# ---------------------------------------------------------------------------
# Strategy 1: multi-channel edge sweep
# ---------------------------------------------------------------------------


def _stretch(
    channel: np.ndarray, low_pct: float = 1.0, high_pct: float = 99.0
) -> np.ndarray | None:
    """Percentile-stretch a chroma channel to 0–255; ``None`` if it is flat.

    Lab a/b and HSV saturation of a typical table scene occupy a narrow band
    (a neutral surface sits at a = b ≈ 128 with a spread of ±10), so Canny
    thresholds derived from the *intensity* median would sit far above any
    gradient the channel contains. Stretching first puts the channel on the same
    footing as the grey image. A flat channel (grey scene: spread under 8 levels)
    is skipped entirely — stretching it would only amplify sensor noise.
    """
    # Percentiles of a 4x4-strided subsample: within a level or two of the full
    # answer for a photo, at 1/16 of the cost (np.percentile partitions the
    # whole array, which was a quarter of the sweep's time).
    lo, hi = np.percentile(channel[::4, ::4], [low_pct, high_pct])
    if hi - lo < 8:
        return None
    return cv2.convertScaleAbs(channel, alpha=255.0 / (hi - lo), beta=-lo * 255.0 / (hi - lo))


def _canny(blurred: np.ndarray, sigma: float | None) -> np.ndarray:
    """Canny with fixed (``sigma is None``) or median-derived thresholds.

    The auto rule ``lo = (1-σ)·median, hi = (1+σ)·median`` (Rosebrock's
    "auto-Canny") adapts the hysteresis band to the image's overall level: a
    dark photo of a dark table has small gradients everywhere, and the fixed
    75/200 band that suits white paper simply finds nothing there.
    """
    if sigma is None:
        return cv2.Canny(blurred, config.CANNY_LOW, config.CANNY_HIGH)
    med = float(np.median(blurred[::4, ::4]))  # subsampled: same median, 16x cheaper
    lo = int(max(0.0, (1.0 - sigma) * med))
    hi = int(min(255.0, (1.0 + sigma) * med))
    # A near-black or near-white median collapses the band to nothing; keep a
    # floor so Canny still has a usable hysteresis window.
    lo = max(lo, 10)
    hi = max(hi, lo + 20)
    return cv2.Canny(blurred, lo, hi)


def edge_candidates(work: np.ndarray) -> StrategyOutput:
    """Bounded sweep of Canny edge maps → contours → quads.

    Sweep axes (all from config): blur kernel (:data:`config.BLUR_KERNELS`),
    Canny sigma (:data:`config.CANNY_SIGMAS`, or the fixed thresholds when
    ``CANNY_MODE=fixed``), channel combination (grey alone, and grey OR-ed with
    the stretched saturation / Lab a / Lab b maps), and morphology (3×3 dilate,
    which thickens and bridges 1 px gaps like the original detector, and a
    ``MORPH_CLOSE_KERNEL`` close, which also seals the wider gaps glare leaves).
    With the defaults that is 2 × 2 × 2 × 2 = 16 contour passes over a 1000 px
    image; the passes closest to the original detector run first so, when two
    passes find the same quad, the classic one is the one kept.

    Returns the candidates plus the OR of every edge map, dilated once, as the
    support map (see :func:`edge_support`).
    """
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    if config.EDGE_CLAHE:
        gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)

    channels: dict[str, np.ndarray] = {}
    wanted = {c.lower() for c in config.EDGE_CHANNELS}
    if "gray" in wanted or not wanted:
        channels["gray"] = gray
    if "s" in wanted:
        s = _stretch(cv2.cvtColor(work, cv2.COLOR_BGR2HSV)[:, :, 1])
        if s is not None:
            channels["s"] = s
    if "a" in wanted or "b" in wanted:
        lab = cv2.cvtColor(work, cv2.COLOR_BGR2LAB)
        for name, idx in (("a", 1), ("b", 2)):
            if name in wanted:
                ch = _stretch(lab[:, :, idx])
                if ch is not None:
                    channels[name] = ch
    if "gray" not in channels:
        channels = {"gray": gray, **channels}

    sigmas: tuple[float | None, ...] = (
        (None,) if config.CANNY_MODE == "fixed" else tuple(config.CANNY_SIGMAS)
    )
    contour_mode = cv2.RETR_EXTERNAL if config.CONTOUR_MODE == "external" else cv2.RETR_LIST
    close_k = max(3, config.MORPH_CLOSE_KERNEL | 1)
    kernel3 = np.ones((3, 3), np.uint8)
    kernel_close = np.ones((close_k, close_k), np.uint8)
    bounds = _area_bounds(work.shape)

    union = np.zeros(gray.shape, np.uint8)
    deduper = _Deduper(config.DEDUP_IOU)
    out: list[Candidate] = []
    for k in config.BLUR_KERNELS:
        k = max(1, int(k) | 1)  # Gaussian kernels must be odd
        blurred = {name: cv2.GaussianBlur(ch, (k, k), 0) for name, ch in channels.items()}
        for sigma in sigmas:
            maps = {name: _canny(b, sigma) for name, b in blurred.items()}
            combos: list[tuple[str, np.ndarray]] = [("gray", maps["gray"])]
            if len(maps) > 1:
                merged = maps["gray"].copy()
                for name, m in maps.items():
                    if name != "gray":
                        merged |= m
                combos.append(("|".join(maps), merged))
            for combo_name, emap in combos:
                union |= emap
                for morph in ("dilate3", "close7"):
                    if morph == "dilate3":
                        binary = cv2.dilate(emap, kernel3, iterations=1)
                    else:
                        binary = cv2.morphologyEx(emap, cv2.MORPH_CLOSE, kernel_close)
                    params = {
                        "blur": k,
                        "sigma": "fixed" if sigma is None else sigma,
                        "channels": combo_name,
                        "morph": morph,
                    }
                    _contours_to_candidates(
                        binary, "edges", params, bounds, deduper, out, mode=contour_mode
                    )
    # The support map is the OR of every pass, thickened to +-2 px: the contour
    # of a dilated edge ring runs ~1.5 px outside the edge itself, and a 1 px band
    # would miss it and under-report the support of a perfect outline.
    support = cv2.dilate(union, np.ones((5, 5), np.uint8), iterations=1)
    return StrategyOutput(out, support, {"edges": union})


# ---------------------------------------------------------------------------
# Strategy 2: background-colour model
# ---------------------------------------------------------------------------


def _border_ring_mask(shape: tuple[int, ...], fraction: float) -> np.ndarray:
    """Boolean mask of a ring ``fraction × min(h, w)`` wide along the image border."""
    h, w = shape[:2]
    t = max(2, int(round(fraction * min(h, w))))
    ring = np.zeros((h, w), dtype=bool)
    ring[:t, :] = True
    ring[-t:, :] = True
    ring[:, :t] = True
    ring[:, -t:] = True
    return ring


def expand_quad(quad: np.ndarray, factor_short: float, factor_long: float) -> np.ndarray:
    """Scale a quad about its centre, separately along its short and long axes.

    Used for the colour strategy's twin: a blob that is really the printed frame
    (the region inside the black border) is grown to the card's outer edge with
    the physical ratios 63/57 (width) and 88/82 (height). The axes are the
    directions of the quad's own sides, so a rotated card expands correctly.
    """
    q = order_points(quad).astype(np.float64)
    centre = q.mean(axis=0)
    u = (q[1] - q[0] + q[2] - q[3]) / 2.0  # side 0-1 direction (and 3-2)
    v = (q[3] - q[0] + q[2] - q[1]) / 2.0  # side 0-3 direction (and 1-2)
    lu, lv = np.linalg.norm(u), np.linalg.norm(v)
    if lu <= 0 or lv <= 0:
        return q.astype(np.float32)
    u /= lu
    v /= lv
    fu, fv = (factor_short, factor_long) if lu < lv else (factor_long, factor_short)
    rel = q - centre
    # Decompose each corner offset in the (u, v) basis, scale, recompose.
    basis = np.stack([u, v], axis=1)  # columns u, v
    coeffs = np.linalg.solve(basis, rel.T).T  # (4, 2): (cu, cv) per corner
    coeffs[:, 0] *= fu
    coeffs[:, 1] *= fv
    return order_points(centre + coeffs @ basis.T)


def background_model(work: np.ndarray) -> tuple[np.ndarray, float]:
    """``(Lab median of the border ring, robust ΔE spread)`` of the surface.

    The ring is where the table is almost always visible (cards are laid in the
    middle of the frame). The median is immune to a card poking into the ring;
    the spread is the 70th percentile of the ring's ΔE from that median, so a
    card covering up to ~30 % of the ring does not make a plain table look
    patterned, while wood grain or a printed playmat does.
    """
    lab = cv2.cvtColor(work, cv2.COLOR_BGR2LAB).astype(np.float32)
    ring = _border_ring_mask(work.shape, config.BG_BORDER_FRACTION)
    ring_px = lab[ring]
    median = np.median(ring_px, axis=0)
    delta = np.linalg.norm(ring_px - median, axis=1)
    spread = float(np.percentile(delta, 70))
    return median, spread


def color_mask_candidates(work: np.ndarray) -> StrategyOutput:
    """Candidates from a "not the table colour" mask (plan idea A10).

    Skipped (empty output) when ``BG_MODE`` is ``off``, or is ``auto`` and the
    border ring's colour spread says the surface is patterned — a ΔE mask of a
    playmat is one giant blob with holes and would only cost time.

    Pipeline: ΔE from the ring median > ``BG_DELTA_E`` → 5×5 open (drops specks)
    → ``MORPH_CLOSE_KERNEL`` close (seals text/art gaps inside a card) →
    external contours → :func:`quad_from_contour`. Each quad is emitted twice
    when ``BG_EMIT_EXPANDED``: as found, and grown by 63/57 × 88/82 (``color+``)
    for the dark-surface case where the mask stops at the printed frame because
    the black border matched the table. The twin inherits its parent's contour
    metrics: there is, by construction, no boundary evidence at the outer edge
    on such a surface, and the pHash verification decides between the two.

    The support map is the mask's morphological gradient, dilated, so edge
    support of the as-found quad is measured against the mask outline.
    """
    empty = StrategyOutput([], np.zeros(work.shape[:2], np.uint8))
    if config.BG_MODE == "off":
        return empty
    median, spread = background_model(work)
    if config.BG_MODE != "always" and spread > config.BG_MAX_SPREAD:
        return empty

    lab = cv2.cvtColor(work, cv2.COLOR_BGR2LAB).astype(np.float32)
    delta = np.linalg.norm(lab - median, axis=2)
    mask = (delta > config.BG_DELTA_E).astype(np.uint8) * 255
    close_k = max(3, config.MORPH_CLOSE_KERNEL | 1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((close_k, close_k), np.uint8))

    bounds = _area_bounds(work.shape)
    deduper = _Deduper(config.DEDUP_IOU)
    found: list[Candidate] = []
    params = {"delta_e": config.BG_DELTA_E, "spread": round(spread, 1)}
    _contours_to_candidates(mask, "color", params, bounds, deduper, found, mode=cv2.RETR_EXTERNAL)

    outline = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    support = cv2.dilate(outline, np.ones((5, 5), np.uint8), iterations=1)

    out: list[Candidate] = []
    distance = support_distance(support) if found else None
    for cand in found:
        cand.metrics["edge_support"] = edge_support(cand.quad, support, distance=distance)
        out.append(cand)
        if not config.BG_EMIT_EXPANDED:
            continue
        twin_quad = expand_quad(cand.quad, 63.0 / 57.0, 88.0 / 82.0)
        twin = Candidate(
            quad=twin_quad,
            source="color+",
            params=dict(cand.params),
            metrics={
                "contour_area": cand.metrics["contour_area"],
                "hits": 1,
                # Inherited: the outer edge has no evidence on the surface this
                # twin exists for; the parent's fill/support stand in for it.
                "edge_support": cand.metrics["edge_support"],
                "rectangularity": min(cand.metrics["contour_area"] / max(cand.area, 1e-9), 1.0),
            },
        )
        out.append(twin)
    return StrategyOutput(out, support, {"mask": mask})


# ---------------------------------------------------------------------------
# Grid split of merged cards
# ---------------------------------------------------------------------------


def _bilinear(quad: np.ndarray, s: float, t: float) -> np.ndarray:
    """Point at fractional position ``(s, t)`` inside a TL/TR/BR/BL quad."""
    q = np.asarray(quad, dtype=np.float64)
    top = (1 - s) * q[0] + s * q[1]
    bottom = (1 - s) * q[3] + s * q[2]
    return (1 - t) * top + t * bottom


def grid_shape(quad: np.ndarray, tolerance: float = 0.08) -> tuple[int, int] | None:
    """``(columns, rows)`` of touching cards a quad's proportions suggest, if any.

    Compares the ratio of the quad's two side lengths (``0-1`` over ``1-2``)
    with every :data:`GRID_SHAPES` layout in both card orientations. A single
    card in either orientation matches nothing here; a 2 × 1 row of portrait
    cards (126 × 88) is within 2.5 % of one landscape card (88 × 63), so this
    heuristic *will* fire on a lone sideways card — callers must let the pHash
    verification (or seam evidence) arbitrate between the parent and its
    children rather than trusting the split blindly. Square grids are not in
    :data:`GRID_SHAPES` at all — see the note there.
    """
    q = order_points(quad).astype(np.float64)
    lu = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2.0
    lv = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2.0
    if lu <= 0 or lv <= 0:
        return None
    observed = lu / lv
    best: tuple[float, tuple[int, int]] | None = None
    for cols, rows in GRID_SHAPES:
        for cw, ch in ((63.0, 88.0), (88.0, 63.0)):
            predicted = cols * cw / (rows * ch)
            err = abs(observed - predicted) / predicted
            if err <= tolerance and (best is None or err < best[0]):
                best = (err, (cols, rows))
    return best[1] if best else None


def seam_support(quad: np.ndarray, cols: int, rows: int, support: np.ndarray) -> float:
    """Mean edge support along the internal seams of a ``cols × rows`` tiling."""
    q = order_points(quad)
    lines = []
    for i in range(1, cols):
        lines.append((_bilinear(q, i / cols, 0.0), _bilinear(q, i / cols, 1.0)))
    for j in range(1, rows):
        lines.append((_bilinear(q, 0.0, j / rows), _bilinear(q, 1.0, j / rows)))
    if not lines:
        return 0.0
    h, w = support.shape[:2]
    scores = []
    for a, b in lines:
        t = np.linspace(0.0, 1.0, 50)
        pts = a[None, :] + t[:, None] * (b - a)[None, :]
        xs = np.clip(np.rint(pts[:, 0]).astype(int), 0, w - 1)
        ys = np.clip(np.rint(pts[:, 1]).astype(int), 0, h - 1)
        scores.append(float((support[ys, xs] > 0).mean()))
    return float(np.mean(scores))


def split_merged(
    cand: Candidate, support: np.ndarray, *, min_seam_support: float = 0.7
) -> list[Candidate]:
    """Tile a grid-shaped candidate into its child cards (plan idea A14).

    Children are ``source="split"``, inherit the parent's params, carry
    ``metrics["grid"]`` and point back at their ``parent``. Two safeguards,
    both learnt from real photos:

    * Every internal seam must be supported by ``min_seam_support`` of the
      support map (0.7: a real seam — border against border, usually with a
      bright gap — is supported end to end, while the art/text-box edges a
      false seam crosses inside a lone card reach 0.4–0.6). Aspect alone cannot
      tell a 2 × 1 row from one landscape card.
    * The children only compete when the parent itself fails verification
      (:func:`prune_split_children`). Half of a real card hashes within 8–14
      bits of *some* indexed card — the shared frame layout dominates a 64-bit
      pHash — so children cannot be allowed to out-rank a parent that the index
      recognised.

    Returns the children (possibly empty); the parent is not modified.
    """
    shape = grid_shape(cand.quad)
    if shape is None:
        return []
    cols, rows = shape
    if seam_support(cand.quad, cols, rows, support) < min_seam_support:
        return []
    q = order_points(cand.quad)
    children: list[Candidate] = []
    for j in range(rows):
        for i in range(cols):
            corners = np.array(
                [
                    _bilinear(q, i / cols, j / rows),
                    _bilinear(q, (i + 1) / cols, j / rows),
                    _bilinear(q, (i + 1) / cols, (j + 1) / rows),
                    _bilinear(q, i / cols, (j + 1) / rows),
                ],
                dtype=np.float32,
            )
            children.append(
                Candidate(
                    quad=order_points(corners),
                    source="split",
                    params=dict(cand.params),
                    metrics={"grid": float(cols * rows), "hits": 1},
                    parent=cand,
                )
            )
    return children


def prune_split_children(cands: list[Candidate]) -> None:
    """Reject every alive ``split`` child whose parent is still alive.

    Called after verification and before NMS: a parent that survived hashing
    (or was never hashed) is the card; its tiles are not. Reason ``split``.
    """
    for c in cands:
        if c.alive and c.source == "split" and c.parent is not None and c.parent.alive:
            c.rejected = "split"


# ---------------------------------------------------------------------------
# Geometric filter + score
# ---------------------------------------------------------------------------


def _aspect_fit(aspect: float) -> float:
    """1 at the true card aspect, falling linearly to 0 at the band's far edge."""
    truth = config.CARD_ASPECT_RATIO
    reach = max(truth - config.ASPECT_MIN, config.ASPECT_MAX - truth, 1e-6)
    return float(max(0.0, 1.0 - abs(aspect - truth) / reach))


def filter_candidates(
    cands: list[Candidate], work_shape: tuple[int, ...], support: np.ndarray | None
) -> list[Candidate]:
    """Apply the geometric filters (plan idea A6) and score the survivors.

    Reason codes, checked in this order so the histogram names the *first*
    failure: ``area`` (outside the area band, or a side shorter than
    ``MIN_SIDE_PX``), ``concave``, ``angles`` (a corner further than
    ``MAX_ANGLE_DEV_DEG`` from 90°), ``aspect`` (outside ``ASPECT_MIN..MAX``),
    ``rect`` (the source contour fills less than ``MIN_RECTANGULARITY`` of the quad),
    ``edge_support`` (perimeter on fewer than ``MIN_EDGE_SUPPORT`` of the
    support map). Metrics a strategy pre-set (``edge_support``,
    ``rectangularity``) are used as-is; the rest are measured here.

    Score for survivors: ``0.4·aspect_fit + 0.3·rectangularity + 0.3·edge_support``
    — aspect is the strongest card prior, the other two say how clean the
    outline evidence is. Already-rejected candidates are skipped.

    Returns the alive candidates (the input list is updated in place).
    """
    min_area, max_area = _area_bounds(work_shape)
    distance = support_distance(support) if support is not None else None
    alive: list[Candidate] = []
    for cand in cands:
        if not cand.alive:
            continue
        q = cand.quad.astype(np.float64)
        m = cand.metrics
        area = cand.area
        sides = [float(np.linalg.norm(q[(k + 1) % 4] - q[k])) for k in range(4)]
        m["min_side"] = min(sides)
        if area < min_area or area > max_area or min(sides) < config.MIN_SIDE_PX:
            cand.rejected = "area"
            continue
        if not cv2.isContourConvex(cand.quad.reshape(-1, 1, 2).astype(np.float32)):
            cand.rejected = "concave"
            continue
        angles = interior_angles(q)
        m["max_angle_dev"] = float(np.nanmax(np.abs(angles - 90.0)))
        if not np.all(np.isfinite(angles)) or m["max_angle_dev"] > config.MAX_ANGLE_DEV_DEG:
            cand.rejected = "angles"
            continue
        m["aspect"] = quad_aspect(q)
        if not config.ASPECT_MIN <= m["aspect"] <= config.ASPECT_MAX:
            cand.rejected = "aspect"
            continue
        if "rectangularity" not in m:
            # Contour fill of the *quad* (not of its minimum bounding box, which
            # geometry.rectangularity uses): a card seen in perspective is a
            # trapezoid that fills only ~85-90 % of its bounding box even when
            # the outline is perfect, and that filter was the top reason true
            # cards were lost on the synthetic set. Fill of the quad is 1 for a
            # clean outline and drops with notches, bends and wrong corners. A
            # ring-like contour (an outline with a gap, see
            # _contours_to_candidates) has no meaningful fill: its hull is the
            # quad, so it is scored as a full box and left to edge support.
            if m.get("ring"):
                m["rectangularity"] = 1.0
            elif "contour_area" in m:
                m["rectangularity"] = min(m["contour_area"] / max(area, 1e-9), 1.0)
            else:
                m["rectangularity"] = 1.0
        if m["rectangularity"] < config.MIN_RECTANGULARITY:
            cand.rejected = "rect"
            continue
        if "edge_support" not in m:
            m["edge_support"] = (
                edge_support(q, support, distance=distance) if support is not None else 1.0
            )
        if m["edge_support"] < config.MIN_EDGE_SUPPORT:
            cand.rejected = "edge_support"
            continue
        cand.score = (
            0.4 * _aspect_fit(m["aspect"]) + 0.3 * m["rectangularity"] + 0.3 * m["edge_support"]
        )
        alive.append(cand)
    return alive


def dedup(cands: list[Candidate], iou_threshold: float | None = None) -> list[Candidate]:
    """Merge near-identical alive candidates across strategies, keeping the best-scored.

    Runs after the filter and before verification so every distinct quad is
    hashed once. The loser is marked ``dup`` and its ``hits`` are added to the
    survivor's. Returns the alive candidates.
    """
    thr = config.DEDUP_IOU if iou_threshold is None else iou_threshold
    # A border-expanded twin carries no evidence of its own, so it must never
    # absorb a candidate that does; it survives dedup only when nothing else
    # near-duplicates it.
    alive = sorted(
        (c for c in cands if c.alive), key=lambda c: (c.source == "color+", -c.score, -c.area)
    )
    deduper = _Deduper(thr)
    kept: list[Candidate] = []
    for cand in alive:
        existing = deduper.find(cand.quad)
        if existing is not None:
            cand.rejected = "dup"
            # The survivor inherits the loser's sweep consensus: the same outline
            # found by the colour mask once and by twelve edge passes is one
            # quad with thirteen hits, whichever copy had the better score.
            winner = kept[existing]
            winner.metrics["hits"] = winner.metrics.get("hits", 1) + cand.metrics.get("hits", 1)
            continue
        deduper.add(cand.quad)
        kept.append(cand)
    return kept


# ---------------------------------------------------------------------------
# Non-maximum suppression
# ---------------------------------------------------------------------------


def nms(
    cands: list[Candidate],
    iou_threshold: float | None = None,
    containment_threshold: float | None = None,
) -> list[Candidate]:
    """Greedy suppression of overlapping and nested candidates (plan idea A7).

    Candidates are visited in :meth:`Candidate.sort_key` order — a hash-verified
    quad first, then by hash distance, geometric score and area — and each kept
    one suppresses every later candidate that overlaps it at ``IoU >=
    NMS_IOU`` **or** whose smaller member is ``NMS_CONTAINMENT`` inside the
    other. The containment rule is what removes the art box found inside a
    card, and the inset colour-mask quad once its expanded twin verified (or
    vice versa). Suppressed candidates get ``rejected = "nms:<k>"`` where ``k``
    is the 1-based index of the winner in the returned list.

    Returns the winners in priority order.
    """
    iou_thr = config.NMS_IOU if iou_threshold is None else iou_threshold
    cont_thr = config.NMS_CONTAINMENT if containment_threshold is None else containment_threshold
    alive = sorted((c for c in cands if c.alive), key=lambda c: c.sort_key())
    kept: list[Candidate] = []
    for cand in alive:
        suppressed_by = None
        for k, winner in enumerate(kept, start=1):
            if (
                quad_iou(cand.quad, winner.quad) >= iou_thr
                or containment(cand.quad, winner.quad) >= cont_thr
            ):
                suppressed_by = k
                break
        if suppressed_by is None:
            kept.append(cand)
        else:
            cand.rejected = f"nms:{suppressed_by}"
    return kept

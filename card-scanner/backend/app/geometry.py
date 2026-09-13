"""
Pure quadrilateral geometry shared by the detector and the evaluation tooling.

Everything here is plain NumPy/OpenCV maths with no I/O, no config and no
database access, so it can be unit-tested exhaustively and reused by both the
runtime detector (`app.detection`) and the offline harnesses
(`app.evaluate_photos`, `app.label_photos`).

Conventions used throughout:

* A **quad** is a ``(4, 2)`` array of ``(x, y)`` pixel coordinates.
* Unless a function says otherwise it expects the quad **ordered** TL, TR, BR, BL
  (clockwise on screen, which in image coordinates — y pointing down — is the
  order :func:`order_points` produces).
* "Geometric" order means the ordering of the shape *as it appears in the
  image*; "printed" order means index 0 is the card's printed top-left corner
  (see ``app.labels.printed_order_from_detection``). Both are still clockwise.

The detector-facing helpers at the end of the module — :func:`quad_from_contour`
(robust quad extraction from a noisy contour), :func:`portrait_quad` /
:func:`warp_to_card` (single-resample card warps) and :func:`refine_corners`
(sub-pixel corner refinement on the full-resolution image) — are still pure
image maths; they take every threshold as an argument so ``app.config`` stays
the only place that owns defaults.
"""

from __future__ import annotations

import cv2
import numpy as np

# Below this area (px²) intersection/IoU maths is treated as degenerate.
_EPS_AREA = 1e-9


def _as_quad(pts: np.ndarray | list) -> np.ndarray:
    """Coerce any 4-point input (lists, ints, ``(4,1,2)`` contours) to float32 ``(4, 2)``."""
    quad = np.asarray(pts, dtype=np.float32).reshape(-1, 2)
    if quad.shape != (4, 2):
        raise ValueError(f"expected 4 points, got shape {quad.shape}")
    return quad


def order_points(pts: np.ndarray) -> np.ndarray:
    """Order four points as top-left, top-right, bottom-right, bottom-left.

    The points are sorted by their angle about the centroid. In image
    coordinates (y down) increasing ``atan2`` angle sweeps clockwise on screen,
    so an ascending angle sort yields a clockwise ring; the ring is then rotated
    so that the point with the smallest ``x + y`` (the classic "top-left" pick)
    comes first.

    Why not the classic sum/difference trick that the PyImageSearch scanner
    uses? For a card rotated near 45° the "smallest ``y - x``" (top-right) pick
    and the "smallest ``x + y``" (top-left) pick land on the *same* corner, so
    two of the four output slots collapse onto one point and the warp becomes
    a degenerate sliver. An angle sort always emits four distinct points and
    agrees with the old rule whenever the old rule was unambiguous
    (axis-aligned and mildly rotated rectangles).

    Args:
        pts: A ``(4, 2)`` array of corner coordinates in any order.

    Returns:
        A ``(4, 2)`` float32 array ordered TL, TR, BR, BL.
    """
    quad = _as_quad(pts)
    centre = quad.mean(axis=0)
    rel = quad - centre
    # atan2 in image coordinates: 0 = right, +90° = down, so ascending = clockwise.
    angles = np.arctan2(rel[:, 1], rel[:, 0])
    ring = quad[np.argsort(angles, kind="stable")]

    # Start the ring at the point with the smallest x + y. For the (near-)45°
    # tie case any of the tied corners is an equally valid "top-left"; argmin
    # picks the first, which is deterministic for a given input.
    start = int(np.argmin(ring.sum(axis=1)))
    return np.roll(ring, -start, axis=0).astype(np.float32)


def warp_size(quad: np.ndarray) -> tuple[int, int]:
    """Destination ``(width, height)`` that :func:`four_point_transform` uses for ``quad``.

    Width is the longer of the two horizontal edges and height the longer of
    the two vertical edges (in the TL, TR, BR, BL order), so the warp neither
    stretches nor squashes the card relative to its largest apparent dimension.
    Exposed separately so callers can predict whether a warp will come out
    landscape (``width > height``) without performing it.

    Args:
        quad: Ordered TL, TR, BR, BL.

    Returns:
        ``(width, height)`` in pixels, each at least 1.
    """
    tl, tr, br, bl = _as_quad(quad)
    width = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    height = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    return max(int(round(width)), 1), max(int(round(height)), 1)


def four_point_transform(image: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Perspective-warp the quadrilateral ``pts`` out of ``image`` into a rectangle.

    The destination size is the larger of each pair of opposing edges (see
    :func:`warp_size`), so the warp neither stretches nor squashes the card
    relative to its largest apparent dimension.

    Args:
        image: Source image to sample from (full resolution for best detail).
        pts:   Four source corners (any order); reordered internally.

    Returns:
        The warped BGR rectangle.
    """
    rect = order_points(pts)
    max_width, max_height = warp_size(rect)
    return warp_ordered_quad(image, rect, max_width, max_height)


def warp_ordered_quad(image: np.ndarray, quad: np.ndarray, width: int, height: int) -> np.ndarray:
    """Warp ``quad`` to a ``width x height`` rectangle **respecting the given order**.

    Unlike :func:`four_point_transform` this does *not* reorder the corners:
    ``quad[0]`` lands at the destination's top-left, ``quad[1]`` at its
    top-right, and so on. Feeding a quad in *printed* order therefore yields an
    upright card crop regardless of how the card lay in the photo — which is
    what the harness's ``--gt-crops`` mode needs.

    Args:
        image:  Source image.
        quad:   Four corners, in the order they should map to TL, TR, BR, BL.
        width:  Destination width in px.
        height: Destination height in px.

    Returns:
        The warped image of shape ``(height, width, channels)``.
    """
    src = _as_quad(quad)
    dst = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32
    )
    matrix = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(image, matrix, (width, height))


def quad_area(quad: np.ndarray) -> float:
    """Area of a simple quadrilateral (shoelace formula), in px²."""
    q = _as_quad(quad).astype(np.float64)
    x, y = q[:, 0], q[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2.0)


def _intersection_area(a: np.ndarray, b: np.ndarray) -> float:
    """Area of the intersection of two convex quads (0 when disjoint/degenerate).

    ``cv2.intersectConvexConvex`` clips one convex polygon against the other
    and returns the area of the result. Both inputs must be convex; a
    non-convex quad is silently treated as its convex hull, which is the
    behaviour we want for slightly bent detections.
    """
    qa = _as_quad(a)
    qb = _as_quad(b)
    area, _pts = cv2.intersectConvexConvex(qa, qb, handleNested=True)
    return float(max(area, 0.0))


def quad_iou(a: np.ndarray, b: np.ndarray) -> float:
    """Intersection-over-union of two convex quads, in ``[0, 1]``."""
    inter = _intersection_area(a, b)
    union = quad_area(a) + quad_area(b) - inter
    if union <= _EPS_AREA:
        return 0.0
    return float(min(inter / union, 1.0))


def containment(a: np.ndarray, b: np.ndarray) -> float:
    """Fraction of the *smaller* quad that lies inside the other, in ``[0, 1]``.

    IoU punishes a small quad nested inside a big one (the art box inside a
    card scores a low IoU with the card), whereas containment is ~1 in that
    case. The detector uses it to suppress nested duplicates.
    """
    inter = _intersection_area(a, b)
    smaller = min(quad_area(a), quad_area(b))
    if smaller <= _EPS_AREA:
        return 0.0
    return float(min(inter / smaller, 1.0))


def match_quads(
    pred: list[np.ndarray], gt: list[np.ndarray], iou_threshold: float = 0.7
) -> tuple[list[tuple[int, int, float]], list[int], list[int]]:
    """Greedy one-to-one matching of predicted quads to ground-truth quads.

    All pairwise IoUs are computed, then pairs are consumed in descending IoU
    order; a pair is accepted only if both sides are still free and the IoU
    reaches ``iou_threshold``. Greedy-by-IoU is the standard detection-metric
    convention (it is what COCO-style evaluators do) and, because real cards
    barely overlap, it is equivalent to the optimal assignment in practice.

    Args:
        pred: Predicted quads (any consistent order).
        gt: Ground-truth quads.
        iou_threshold: Minimum IoU for a pair to count as a match.

    Returns:
        ``(matches, unmatched_pred, unmatched_gt)`` where ``matches`` is a list
        of ``(pred_index, gt_index, iou)`` and the other two are index lists.
    """
    if not pred or not gt:
        return [], list(range(len(pred))), list(range(len(gt)))

    ious = np.zeros((len(pred), len(gt)), dtype=np.float64)
    for i, p in enumerate(pred):
        for j, g in enumerate(gt):
            ious[i, j] = quad_iou(p, g)

    # Flatten, sort descending; ties broken by (pred, gt) index for determinism.
    order = sorted(
        ((ious[i, j], i, j) for i in range(len(pred)) for j in range(len(gt))),
        key=lambda t: (-t[0], t[1], t[2]),
    )
    used_pred: set[int] = set()
    used_gt: set[int] = set()
    matches: list[tuple[int, int, float]] = []
    for iou, i, j in order:
        if iou < iou_threshold:
            break  # everything after this is below threshold too
        if i in used_pred or j in used_gt:
            continue
        used_pred.add(i)
        used_gt.add(j)
        matches.append((i, j, float(iou)))

    unmatched_pred = [i for i in range(len(pred)) if i not in used_pred]
    unmatched_gt = [j for j in range(len(gt)) if j not in used_gt]
    return matches, unmatched_pred, unmatched_gt


def corner_error(pred: np.ndarray, gt: np.ndarray) -> float:
    """Mean corner-to-corner distance (px), minimised over the 4 cyclic shifts.

    Both quads must be in the same rotational sense (both clockwise), but they
    need not start at the same corner: a detector that finds the right shape
    but labels a different corner "first" is not penalised, because the
    printed-vs-geometric starting corner is a separate concern (orientation).

    Args:
        pred: Predicted quad.
        gt: Ground-truth quad.

    Returns:
        The smallest mean Euclidean corner distance over the four shifts.
    """
    p = _as_quad(pred).astype(np.float64)
    g = _as_quad(gt).astype(np.float64)
    best = float("inf")
    for shift in range(4):
        d = np.linalg.norm(np.roll(p, -shift, axis=0) - g, axis=1).mean()
        best = min(best, float(d))
    return best


def nms_quads(
    quads: list[np.ndarray], scores: list[float], iou_threshold: float = 0.5
) -> list[int]:
    """Non-maximum suppression over quads; returns the indices kept, best first.

    Standard greedy NMS: take the highest-scoring quad, drop everything that
    overlaps it with ``IoU >= iou_threshold``, repeat. Ties in score are broken
    by original index so results are deterministic.

    Args:
        quads: Candidate quads.
        scores: One score per quad (higher is better).
        iou_threshold: Overlap at or above which the lower-scored quad is dropped.

    Returns:
        Indices into ``quads`` that survive, in descending score order.
    """
    if len(quads) != len(scores):
        raise ValueError("quads and scores must have the same length")
    order = sorted(range(len(quads)), key=lambda i: (-float(scores[i]), i))
    kept: list[int] = []
    for i in order:
        if all(quad_iou(quads[i], quads[k]) < iou_threshold for k in kept):
            kept.append(i)
    return kept


def quad_aspect(quad: np.ndarray) -> float:
    """Short/long side ratio using the mean of each pair of opposite edges.

    Opposite edges are ``(0-1, 2-3)`` and ``(1-2, 3-0)``, so any cyclic order
    gives the same answer. Averaging opposite edges makes the estimate robust
    to mild perspective (one edge foreshortened, its twin not). A real 63×88 mm
    card gives ≈ 0.716; the detector's aspect filter is a band around that.

    Returns:
        A value in ``(0, 1]``; 0 for a degenerate quad.
    """
    q = _as_quad(quad).astype(np.float64)
    e = [np.linalg.norm(q[(k + 1) % 4] - q[k]) for k in range(4)]
    a = (e[0] + e[2]) / 2.0
    b = (e[1] + e[3]) / 2.0
    longest = max(a, b)
    if longest <= 0:
        return 0.0
    return float(min(a, b) / longest)


def rectangularity(contour_area: float, quad: np.ndarray) -> float:
    """How well a contour fills the minimum-area rectangle around ``quad``.

    Defined as ``contour_area / area(minAreaRect(quad))``, clipped to
    ``[0, 1]``. A clean card outline scores ≈ 1; a triangle-ish or heavily
    notched blob whose polygon approximation still happens to have four
    vertices scores noticeably lower, which is what the detector's filter uses
    to reject it.

    Args:
        contour_area: ``cv2.contourArea`` of the *source* contour (not the quad).
        quad: The quad extracted from that contour.
    """
    q = _as_quad(quad)
    (_cx, _cy), (w, h), _angle = cv2.minAreaRect(q)
    box_area = float(w) * float(h)
    if box_area <= _EPS_AREA:
        return 0.0
    return float(min(max(contour_area / box_area, 0.0), 1.0))


def interior_angles(quad: np.ndarray) -> np.ndarray:
    """Interior angle at each vertex, in degrees, in vertex order.

    Computed from the two edges meeting at each vertex; for a convex quad the
    four values sum to 360 and a rectangle under mild perspective stays near
    90° at every corner. Degenerate (zero-length) edges yield ``nan``.
    """
    q = _as_quad(quad).astype(np.float64)
    out = np.empty(4, dtype=np.float64)
    for k in range(4):
        prev_v = q[(k - 1) % 4] - q[k]
        next_v = q[(k + 1) % 4] - q[k]
        denom = np.linalg.norm(prev_v) * np.linalg.norm(next_v)
        if denom <= 0:
            out[k] = np.nan
            continue
        cos = np.clip(np.dot(prev_v, next_v) / denom, -1.0, 1.0)
        out[k] = float(np.degrees(np.arccos(cos)))
    return out


def intersect_lines(
    p1: np.ndarray, p2: np.ndarray, p3: np.ndarray, p4: np.ndarray
) -> np.ndarray | None:
    """Intersection point of the infinite lines ``p1p2`` and ``p3p4``.

    Uses the homogeneous cross-product formulation, which handles vertical
    lines without special-casing. Returns ``None`` when the lines are parallel
    (or coincident), signalled by a vanishing homogeneous ``w``.

    Args:
        p1, p2: Two points on the first line.
        p3, p4: Two points on the second line.

    Returns:
        A ``(2,)`` float64 array ``(x, y)`` or ``None``.
    """
    a = np.array([*np.asarray(p1, dtype=np.float64), 1.0])
    b = np.array([*np.asarray(p2, dtype=np.float64), 1.0])
    c = np.array([*np.asarray(p3, dtype=np.float64), 1.0])
    d = np.array([*np.asarray(p4, dtype=np.float64), 1.0])
    line1 = np.cross(a, b)
    line2 = np.cross(c, d)
    pt = np.cross(line1, line2)
    # Scale-aware parallel test: |w| relative to the line magnitudes.
    scale = max(np.linalg.norm(line1[:2]) * np.linalg.norm(line2[:2]), 1e-12)
    if abs(pt[2]) <= 1e-9 * scale:
        return None
    return pt[:2] / pt[2]


# ---------------------------------------------------------------------------
# Detector helpers: quad extraction, card warps, corner refinement
# ---------------------------------------------------------------------------


def _quad_from_polygon(poly: np.ndarray) -> np.ndarray | None:
    """Reduce a convex 5–10-gon to a quad by intersecting its four longest edges.

    A card with a finger over one corner, a die on its edge or a visibly
    rounded corner approximates to five or more vertices: the true sides are
    still the four *longest* edges, and the short ones are the notch. Keeping
    the long edges in their cyclic order and intersecting neighbours recovers
    the corners the notch hid. Returns ``None`` when two chosen neighbours are
    parallel (degenerate polygon) or the result is not convex.
    """
    pts = np.asarray(poly, dtype=np.float64).reshape(-1, 2)
    n = len(pts)
    lengths = [np.linalg.norm(pts[(k + 1) % n] - pts[k]) for k in range(n)]
    # Indices of the four longest edges, restored to cyclic order.
    longest = sorted(sorted(range(n), key=lambda k: -lengths[k])[:4])
    corners = []
    for i in range(4):
        a = longest[i]
        b = longest[(i + 1) % 4]
        pt = intersect_lines(pts[a], pts[(a + 1) % n], pts[b], pts[(b + 1) % n])
        if pt is None:
            return None
        corners.append(pt)
    quad = np.asarray(corners, dtype=np.float32)
    if not np.all(np.isfinite(quad)) or not cv2.isContourConvex(quad.reshape(-1, 1, 2)):
        return None
    return quad


def quad_from_contour(
    contour: np.ndarray,
    eps_ratios: tuple[float, ...] = (0.02, 0.03, 0.05),
    *,
    min_box_fill: float = 0.9,
) -> np.ndarray | None:
    """Extract a card-like quad from a contour, tolerating notches and round corners.

    Strategy, in order (first success wins):

    1. Convex hull, then ``approxPolyDP`` at each epsilon in ``eps_ratios``
       (fractions of the hull perimeter, small to large). A clean outline
       collapses to four vertices at 2 %, which is exactly today's detector; the
       larger epsilons absorb rounded corners and JPEG wobble that keep a card at
       five or six vertices at 2 %.
    2. For 5–10 vertices at any epsilon, intersect the four longest edges (see
       :func:`_quad_from_polygon`).
    3. ``minAreaRect`` of the hull, accepted only when the hull fills at least
       ``min_box_fill`` of that box — a bent or chewed outline that is still
       essentially rectangular. Below that fill the contour is not a card.

    The hull step matters on its own: an outline with a concavity (a finger, a
    reflection cutting into the border) has no convex 4-gon approximation at all,
    but its hull does.

    Args:
        contour: An OpenCV contour (``(N, 1, 2)`` int or float).
        eps_ratios: ``approxPolyDP`` epsilons as fractions of the perimeter.
        min_box_fill: Hull-area / box-area floor for the ``minAreaRect`` fallback.

    Returns:
        A ``(4, 2)`` float32 quad (unordered; callers run :func:`order_points`)
        or ``None`` when nothing card-like can be extracted.
    """
    if contour is None or len(contour) < 4:
        return None
    hull = cv2.convexHull(np.asarray(contour, dtype=np.float32).reshape(-1, 1, 2))
    if len(hull) < 4:
        return None
    perimeter = cv2.arcLength(hull, True)
    if perimeter <= 0:
        return None
    for eps in eps_ratios:
        approx = cv2.approxPolyDP(hull, eps * perimeter, True).reshape(-1, 2)
        if len(approx) == 4:
            return approx.astype(np.float32)
        if 5 <= len(approx) <= 10:
            quad = _quad_from_polygon(approx)
            if quad is not None:
                return quad
    # Fallback: the minimum-area bounding box, if the hull is rectangular enough.
    (_cx, _cy), (w, h), _angle = cv2.minAreaRect(hull)
    box_area = float(w) * float(h)
    if box_area <= _EPS_AREA:
        return None
    if cv2.contourArea(hull) / box_area >= min_box_fill:
        return cv2.boxPoints(((_cx, _cy), (w, h), _angle)).astype(np.float32)
    return None


def portrait_quad(quad: np.ndarray) -> np.ndarray:
    """Reorder a geometric TL/TR/BR/BL quad so warping it yields a *portrait* card.

    A card lying sideways produces a landscape warp; the old pipeline rotated
    that warp 90° clockwise afterwards. Rotating an image 90° CW maps its
    bottom-left corner to the top-left, so the same result comes for free by
    warping with the corners cycled one step (``BL, TL, TR, BR``) — no second
    resample. Portrait quads are returned unchanged.

    "Landscape" is decided on the mean of each pair of opposite edges (robust
    to mild perspective, like :func:`quad_aspect`).
    """
    q = order_points(quad)
    horizontal = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2.0
    vertical = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2.0
    if horizontal > vertical:
        return q[[3, 0, 1, 2]]
    return q


def warp_to_card(
    image: np.ndarray,
    quad: np.ndarray,
    width: int,
    height: int,
    *,
    oversample: int = 2,
    max_hires_height: int | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Warp ``quad`` out of ``image`` into a portrait ``width x height`` card crop.

    Single-resample path: the perspective warp samples the *source* directly
    into an ``oversample``× larger portrait canvas, which is then reduced once
    with ``INTER_AREA``. The old pipeline warped to the quad's natural size and
    resized again, and each resample softens text; here the only lossy step is
    the final area-average, which is the highest-quality reduction OpenCV has.

    The oversampled warp is returned as well: it is the higher-resolution view
    of the same card that the OCR band passes read the collector line from
    (capped at ``max_hires_height`` rows so a huge output size cannot blow up
    OCR time).

    Args:
        image: Source image (full resolution for best detail).
        quad: Four corners in any order; portrait orientation is derived.
        width: Output crop width (px).
        height: Output crop height (px).
        oversample: Integer factor for the intermediate warp.
        max_hires_height: Cap on the returned high-res warp's height.

    Returns:
        ``(crop, hires)`` — the ``height x width`` crop and the oversampled warp.
    """
    q = portrait_quad(quad)
    big_w, big_h = width * oversample, height * oversample
    hires = warp_ordered_quad(image, q, big_w, big_h)
    crop = cv2.resize(hires, (width, height), interpolation=cv2.INTER_AREA)
    if max_hires_height is not None and big_h > max_hires_height:
        scale = max_hires_height / big_h
        hires = cv2.resize(
            hires,
            (max(int(round(big_w * scale)), 1), max_hires_height),
            interpolation=cv2.INTER_AREA,
        )
    return crop, hires


def _edge_run_qualifies(
    prof: np.ndarray,
    steps: np.ndarray,
    span: int,
    zero: int,
    run_pos: float,
    tolerance: float,
    min_gradient: float = 5.0,
    inside_level: float | None = None,
    inside_tolerance: float | None = None,
    rise_fraction: float = 0.2,
    contrast: float | None = None,
) -> bool:
    """Whether a gradient run looks like *this card's* border→surface edge.

    See :func:`refine_corners` step 2b. ``prof`` is one intensity profile along
    the outward normal (index 0 at the inward limit), ``steps`` its positions,
    ``zero`` the index of the coarse line, ``span`` the differencing span,
    ``inside_level`` the 10th percentile of the profile up to the coarse line
    (computed here when not given).

    Two rules, by where the run lies:

    * **Outward** (past the coarse line). The border is the plateau just
      inside the run — the median of the last few samples before it. Walking
      out from the coarse line, the profile may first *enter* that plateau
      (a coarse line that hugged the printed frame still has the whole
      border ahead of it) but must never leave it again before the run: a run
      reached by crossing the bright paper gap belongs to a neighbouring
      card, and before entering it the profile may descend (frame → border)
      but never rise above the level just inside the line (that rise is the
      paper gap). The plateau must be no brighter than ``inside_level`` plus
      ``tolerance`` — a card's drop shadow is a flat dark→bright stretch too,
      but brighter than the border it borders; the percentile (not the
      minimum) means one foil sparkle cannot set the level while a thin
      borderless-card edge still does. And the run must be dark→bright by at
      least ``min_gradient``: leaving the border for the surface.
    * **At or inward** (the coarse line is on the edge, or overshot): the
      plateau just inside the run must be the darkest level between the inward
      limit and the run — the border is the darkest thing inside a
      black-bordered card.

    In every position the run must be dark→bright by a share of the contrast
    seen from the coarse line outward: the border ends where something
    brighter begins, and the frame→border drop beside an inset line, being
    bright→dark, is never the edge.
    """
    n = len(prof)
    at = int(np.clip(round(run_pos - steps[0]), 0, n - 1))
    inner = int(np.clip(round(run_pos - steps[0] - span), 0, n - 1))
    # The border is the plateau just inside the run; the edge leaves it for
    # something brighter, by a meaningful share of the contrast seen from the
    # coarse line outward (on a smooth surface the absolute floor is tiny and
    # an 11-level ripple would otherwise pass). This polarity holds wherever
    # the run lies: the frame→border drop beside an inset line is bright→dark
    # and can never be the edge.
    tail = prof[max(0, inner - span) : inner + 1]
    plateau = float(np.median(tail))
    outer = prof[min(at + span, n - 1) : min(at + 2 * span, n)]
    if outer.size == 0:
        return False
    if contrast is None:
        lo, hi = np.percentile(prof[zero:], [5, 95])
        contrast = float(hi - lo)
    rise = max(min_gradient, rise_fraction * contrast)
    if float(np.median(outer)) < plateau + rise:
        return False
    if run_pos > 0 and inner >= zero:
        stretch = prof[zero : inner + 1]
        within = np.abs(stretch - plateau) <= tolerance
        if not within.any():
            return False
        entry = int(np.argmax(within))
        if not within[entry:].all():
            return False  # left the border again before the run: crossed a gap
        # Before entering the plateau the profile may descend into it (a coarse
        # line that hugged the frame: frame → border, a sharp drop that is over
        # within a few spans) but never slowly — a ramp that takes longer is a
        # shadow falling across whatever lies beyond the card — and never rise
        # above the level just inside the coarse line first: that rise is the paper gap
        # between this card and a neighbour whose border the run belongs to.
        if entry > 3 * span:
            return False
        just_inside = float(prof[max(0, zero - span) : max(zero, 1)].max())
        if entry and float(stretch[:entry].max()) > just_inside + tolerance:
            return False
        if inside_level is None:
            inside_level = float(np.percentile(prof[: zero + 1], 10))
        return plateau <= inside_level + (
            tolerance if inside_tolerance is None else inside_tolerance
        )
    # At or inside the coarse line: the plateau must be the darkest thing
    # between the inward limit and the run — the border of a black-bordered card.
    border_level = float(prof[: at + 1].min())
    return abs(plateau - border_level) <= tolerance


def _strong_runs(
    g: np.ndarray, wide: np.ndarray, positions: np.ndarray, floor: float, min_sharpness: float
) -> list[tuple[float, float]]:
    """Contiguous runs of strong, sharp gradients as ``(centroid position, peak)``."""
    strong = (g >= floor) & (g >= min_sharpness * wide)
    if not strong.any():
        return []
    idx = np.flatnonzero(strong)
    breaks = np.flatnonzero(np.diff(idx) > 1) + 1
    runs = []
    for run_idx in np.split(idx, breaks):
        weights = g[run_idx]
        runs.append(
            (float(np.dot(positions[run_idx], weights) / weights.sum()), float(weights.max()))
        )
    return runs


def refine_corners(
    image: np.ndarray,
    quad: np.ndarray,
    band_in_ratio: float = 0.015,
    band_out_ratio: float = 0.06,
    samples: int = 64,
    *,
    search_in_ratio: float = 0.04,
    min_gradient: float = 5.0,
    min_sharpness: float = 0.6,
    noise_factor: float = 2.5,
    border_tolerance: float = 20.0,
    min_side_fraction: float = 0.4,
    max_area_change: float = 0.35,
    border_step: bool = False,
    max_border_ratio: float = 0.06,
    step_min_sharpness: float = 0.6,
    step_rise_fraction: float = 0.35,
    inside_tolerance: float = 40.0,
    debug: dict | None = None,
) -> np.ndarray:
    """Snap a coarse quad onto the card's true edges at full resolution.

    The detector finds quads on a downscaled working copy (a 4000 px photo is
    processed at 1000 px, so every corner carries ~4 px of quantisation), and
    some strategies deliver systematically inset or outset estimates (the
    colour-mask twin, ``minAreaRect`` fallbacks). This routine re-measures each
    side directly:

    1. Along each side, ``samples`` points between 10 % and 90 % of its length
       (the ends are skipped: rounded corners have no straight edge) are the
       bases of 1 px-stepped intensity profiles taken along the side's
       *outward* normal, from ``band_in_ratio`` inside to ``band_out_ratio``
       outside (both fractions of the card's long edge). All profiles of a side
       come from one ``cv2.remap`` over a padded grey ROI, so the cost is
       independent of the photo size.
    2. In each profile, *strong* gradients are found first. The gradient is
       the absolute intensity difference over a span of 0.5 % of the card's
       long edge (at least 3 px — a defocused edge on a 2000 px card is ~10 px
       wide), after averaging each profile with its two neighbours (1-2-1) to
       knock down sensor noise; "strong" is an *absolute* floor of
       ``min_gradient`` grey levels (5: the border→table step on a dark
       surface is 5–15 levels, and the noise-adaptive floor below guards
       grainy surfaces).
       Absolute, not relative to the profile's maximum: on a dark table the
       real border→table step is ~10-15 levels while the frame→border step a
       few pixels inside can be 200, and a relative rule would always pick the
       bright inner one. A strong value must also be *sharp*: its one-span
       difference must be at least ``min_sharpness`` of the three-span
       difference centred on the same spot. A card edge completes within
       about a span even when slightly defocused (the two agree), whereas the
       boundary of a drop shadow is a penumbra several spans wide whose short
       difference is a fraction of its long one. Strong values are grouped
       into contiguous runs, each located at its gradient-weighted centroid
       (a step lights up `span` adjacent differences, so a plateau rather than
       a peak is the normal case).
    2b. Which run is the edge. The card's own edge is the transition *out of
       the border colour*: just inside it the intensity is the border's — black
       on almost every card — and the border is the darkest thing between the
       inward sampling limit and the edge. A run **qualifies** when (a) the
       intensity one span inside it is within ``border_tolerance`` of the
       darkest sample from the inward limit up to the run, and (b) for runs
       outside the coarse line, every sample between the coarse line and the
       run also stays that dark — the search may cross the card's *own*
       border (a coarse contour that hugged the printed frame on a dark
       surface, or under a merged drop shadow) but never a bright gap, which
       is what separates this card's edge from a neighbouring card's border a
       few percent further out. The same two tests reject a sleeve edge, a
       shadow boundary and paper grain (all have paper inside them) and the
       frame→border transition (frame inside it). The choice is the
       **outermost qualifying run**; with none, the strongest run within
       ``[-band_in, +2·band_in]`` of the coarse line; with no run there
       either, the sample abstains — the remaining runs are the printed frame
       far inside or something else far outside, and the coarse line is the
       better estimate of an invisible edge. (The profile is sampled
       ``search_in_ratio`` deep so a shadow-inflated estimate can still reach
       its true edge, which qualifies.) White-bordered cards fall through to
       the strongest-run rule. The floor is also lifted to ``noise_factor`` × the median
       gradient of the profile's outward half so a grainy surface cannot
       manufacture runs on its own (the inward half is excluded: the card's
       own frame and art would raise the floor above a faint border→table
       step).
    3. A side with edge points on fewer than ``min_side_fraction`` of its
       samples keeps its original line (no evidence — e.g. a black border on a
       black cloth). Otherwise ``cv2.fitLine`` with the Huber loss fits the
       points, which tolerates the odd outlier from a neighbouring card.
    4. The four lines are intersected. The result is rejected (the input is
       returned unchanged) when any corner moved further than the search band
       allows, when two lines are parallel, or when the area changed by more
       than ``max_area_change`` — any of those means the profiles locked onto
       something other than this card's outline.

    Args:
        image: Full-resolution BGR (or grey) image.
        quad: The coarse quad, any corner order, in ``image`` coordinates.
        band_in_ratio: Inward half-width of the *near* band (fraction of the
            card's long edge) in which the coarse position is trusted.
        band_out_ratio: Outward sampling reach, same units.
        search_in_ratio: Inward sampling reach, same units. Deeper than the
            near band so a coarse quad inflated by the card's own drop shadow
            (the black border and the dark shadow merge into one contour, 2-4 %
            further out) can still find the true edge inward.
        samples: Profiles per side.
        min_gradient: Absolute gradient floor (grey levels over one span) for an edge.
        min_sharpness: Minimum ratio of the one-span to the three-span
            difference for a gradient to count as an edge rather than a soft ramp.
        noise_factor: The floor is raised to this multiple of the profile's
            median gradient (a grain/noise estimate) when that is higher.
        border_tolerance: Grey-level tolerance for a run's inner side to count
            as the border colour.
        min_side_fraction: Minimum fraction of profiles with an edge for a side
            to be re-fitted.
        max_area_change: Relative area change beyond which the refinement is
            discarded as a mis-lock.

    Returns:
        The refined quad ordered TL, TR, BR, BL (float32), or the ordered input
        when refinement was not possible or failed its guards.
    """
    q = order_points(quad).astype(np.float64)
    sides = [np.linalg.norm(q[(k + 1) % 4] - q[k]) for k in range(4)]
    long_edge = max(sides)
    if long_edge < 8:
        return q.astype(np.float32)
    band_in = max(1.0, band_in_ratio * long_edge)
    band_out = max(2.0, band_out_ratio * long_edge)
    search_in = max(band_in, search_in_ratio * long_edge)

    # Padded ROI around the quad; profiles never leave it.
    h, w = image.shape[:2]
    pad = int(np.ceil(max(band_out, search_in))) + 3
    x0 = int(max(np.floor(q[:, 0].min()) - pad, 0))
    y0 = int(max(np.floor(q[:, 1].min()) - pad, 0))
    x1 = int(min(np.ceil(q[:, 0].max()) + pad, w))
    y1 = int(min(np.ceil(q[:, 1].max()) + pad, h))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return q.astype(np.float32)
    roi = image[y0:y1, x0:x1]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if roi.ndim == 3 else roi
    gray = gray.astype(np.float32)

    centre = q.mean(axis=0)
    steps = np.arange(-search_in, band_out + 1.0, 1.0)
    fractions = np.linspace(0.1, 0.9, samples)

    lines: list[tuple[np.ndarray, np.ndarray]] = []
    for k in range(4):
        a, b = q[k], q[(k + 1) % 4]
        direction = b - a
        length = np.linalg.norm(direction)
        if length <= 0:
            return q.astype(np.float32)
        tangent = direction / length
        normal = np.array([tangent[1], -tangent[0]])
        if np.dot(normal, a - centre) < 0:
            normal = -normal  # make it point away from the card

        base = a[None, :] + fractions[:, None] * direction[None, :]  # (samples, 2)
        pts = base[:, None, :] + steps[None, :, None] * normal[None, None, :]
        map_x = (pts[..., 0] - x0).astype(np.float32)
        map_y = (pts[..., 1] - y0).astype(np.float32)
        profiles = cv2.remap(
            gray, map_x, map_y, interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
        )
        # 1-2-1 smoothing across neighbouring profiles (same side, adjacent
        # bases) before differencing: independent sensor noise drops by ~2x
        # while a straight edge, being common to all of them, is untouched.
        if samples >= 3:
            smoothed = profiles.copy()
            smoothed[1:-1] = 0.25 * profiles[:-2] + 0.5 * profiles[1:-1] + 0.25 * profiles[2:]
            profiles = smoothed
        # Difference over `span` px (0.5 % of the card's long edge, at least 3):
        # the step of a real edge is spread by optics, defocus and JPEG over
        # several pixels — ~10 px on a 2000 px card — so a 1 px difference
        # under-reads it. Difference i spans steps[i] .. steps[i + span] and is
        # centred at steps[i] + span / 2.
        span = max(3, int(round(0.005 * long_edge)))
        grad = np.abs(profiles[:, span:] - profiles[:, :-span])
        positions = steps[:-span] + span / 2.0
        # Difference over 3 x span centred on the same positions (ends
        # replicated), for the sharpness test: a transition that completes
        # within ~1.5 span gives grad ~ wide; a penumbra several spans wide
        # gives grad << wide.
        padded = np.pad(profiles, ((0, 0), (span, span)), mode="edge")
        wide = np.abs(padded[:, 3 * span :] - padded[:, : -3 * span])

        zero_g = int(np.count_nonzero(positions < 0))  # first gradient index outside the line
        zero = int(np.count_nonzero(steps < 0))  # index of the coarse position
        inside_levels = np.percentile(profiles[:, : zero + 1], 10, axis=1)
        lo_hi = np.percentile(profiles[:, zero:], [5, 95], axis=1)
        contrasts = lo_hi[1] - lo_hi[0]
        edge_points = []
        chosen: list[float] = []
        evidence = 0  # samples where a run *qualified* as this card's edge
        for i in range(samples):
            g = grad[i]
            # Noise floor from the *outward* half only: the inward half reaches
            # into the card's frame and art, whose real edges would inflate a
            # median taken over the whole profile and hide a faint border→table
            # step (~13 grey levels on a dark surface).
            outer = g[zero_g:] if zero_g < len(g) else g
            floor = max(min_gradient, noise_factor * float(np.median(outer)))
            runs = _strong_runs(g, wide[i], positions, floor, min_sharpness)
            if not runs:
                continue
            prof = profiles[i]
            candidates = [
                r
                for r in runs
                if -band_in <= r[0] <= band_out
                and _edge_run_qualifies(
                    prof,
                    steps,
                    span,
                    zero,
                    r[0],
                    border_tolerance,
                    min_gradient,
                    float(inside_levels[i]),
                    inside_tolerance,
                    0.2,
                    float(contrasts[i]),
                )
            ]
            near = [r for r in runs if -band_in <= r[0] <= 2.0 * band_in]
            if debug is not None and i % 16 == 0:
                debug.setdefault("trace", []).append(
                    (
                        k,
                        i,
                        [(round(r[0]), round(r[1])) for r in runs],
                        [round(r[0]) for r in candidates],
                        round(float(inside_levels[i])),
                    )
                )
            if candidates:
                evidence += 1
                # A qualifying run must also be a real step: at least half as
                # strong as the strongest one that qualified, so an 11-level
                # ripple beside the line cannot outrank a 40-level border edge
                # one border-width further out.
                strongest = max(r[1] for r in candidates)
                candidates = [r for r in candidates if r[1] >= 0.5 * strongest]
            at_line = [r for r in candidates if abs(r[0]) <= band_in]
            outward = [r for r in candidates if r[0] > band_in]
            if at_line:
                pos = max(at_line, key=lambda r: r[1])[0]  # the line is on the edge
            elif outward:
                # The *nearest* qualifying step beyond the line: the coarse line
                # sat inside the card (on the frame, or inside a washed-out
                # border) and the first border→surface step out is its edge;
                # anything further is texture or a neighbouring card.
                pos = min(outward, key=lambda r: r[0])[0]
            elif near:
                pos = max(near, key=lambda r: r[1])[0]
            else:
                # No border-like run anywhere and nothing near the coarse line:
                # the edge is invisible here (black border on black cloth). The
                # only runs left are far inside (the printed frame) or far
                # outside (something else) — taking either would be worse than
                # keeping the coarse line, so this sample contributes nothing.
                continue
            chosen.append(pos)
            edge_points.append(base[i] + pos * normal)

        # 3. Border step on a textured surface. On a playmat or wood grain the
        #    per-profile noise floor (2.5 x the median outward gradient) sits
        #    above the border→surface step itself (39-59 grey levels for a
        #    black border on a mid-tone mat), so most samples find no
        #    qualifying edge at all and fall back to whatever lies nearest the
        #    coarse line — typically the *inner* edge of the border. Only then
        #    (fewer than half the samples had evidence) the mean of all the
        #    side's profiles, which averages the texture away while the
        #    straight edge common to all of them survives, is searched for the
        #    outermost qualifying dark→bright run within ``max_border_ratio``
        #    of the long edge, and the whole side shifts there. Moving a whole
        #    side on averaged evidence needs a big step — ``step_rise_fraction``
        #    of the outward contrast, three times the absolute floor — so a
        #    ripple in a binder pocket's texture never drags a side away.
        if border_step and evidence < 0.5 * samples:
            mean_prof = profiles.mean(axis=0)
            # A border→mat step is soft (defocus, rounded corners, the mat's
            # nap: ~15 px wide on a 1200 px card), so it is differenced over
            # twice the span: a real step still completes within that, and
            # keeps the same sharpness bar, while a shadow ramp several times
            # longer does not.
            span2 = 2 * span
            mg = np.abs(mean_prof[span2:] - mean_prof[:-span2])
            mpos = steps[:-span2] + span2 / 2.0
            mpad = np.pad(mean_prof, (span2, span2), mode="edge")
            mwide = np.abs(mpad[3 * span2 :] - mpad[: -3 * span2])
            limit = min(band_out, max_border_ratio * long_edge)
            step_runs = [
                r
                for r in _strong_runs(mg, mwide, mpos, min_gradient, step_min_sharpness)
                if band_in < r[0] <= limit
                and _edge_run_qualifies(
                    mean_prof,
                    steps,
                    span,
                    zero,
                    r[0],
                    border_tolerance,
                    3.0 * min_gradient,
                    None,
                    inside_tolerance,
                    step_rise_fraction,
                )
            ]
            if step_runs:
                pos = max(step_runs, key=lambda r: r[0])[0]
                edge_points = [base[i] + pos * normal for i in range(samples)]
                if debug is not None:
                    debug.setdefault("step", {})[k] = pos
        if debug is not None:
            debug.setdefault("chosen", {})[k] = list(chosen)

        if len(edge_points) < max(2, int(min_side_fraction * samples)):
            lines.append((a, b))
            continue
        pts_arr = np.asarray(edge_points, dtype=np.float32)
        vx, vy, px, py = cv2.fitLine(pts_arr, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        # Second pass: a third of the votes can sit on texture a border-width
        # further out; a Huber fit bends towards them. Drop what lies more than
        # two spans off the first line and refit on the rest.
        line_n = np.array([vy, -vx], dtype=np.float64)
        resid = np.abs((pts_arr.astype(np.float64) - [px, py]) @ line_n)
        keep = resid <= max(2.0 * span, 0.01 * long_edge)
        if keep.sum() >= max(2, int(min_side_fraction * samples)) and not keep.all():
            vx, vy, px, py = cv2.fitLine(pts_arr[keep], cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        p0 = np.array([px, py], dtype=np.float64)
        lines.append((p0, p0 + np.array([vx, vy], dtype=np.float64) * length))

    refined = np.empty((4, 2), dtype=np.float64)
    for k in range(4):
        prev_line = lines[(k - 1) % 4]
        this_line = lines[k]
        pt = intersect_lines(prev_line[0], prev_line[1], this_line[0], this_line[1])
        if pt is None:
            return q.astype(np.float32)
        refined[k] = pt

    # Guards: a corner is the meeting point of two shifted lines, so it may move
    # a little more than one band (sqrt(2) x at a right angle); beyond 1.5 x the
    # outward band something else was found.
    max_move = 1.5 * max(band_out, band_in)
    if np.linalg.norm(refined - q, axis=1).max() > max_move:
        return q.astype(np.float32)
    old_area, new_area = quad_area(q), quad_area(refined)
    if old_area <= _EPS_AREA or abs(new_area - old_area) / old_area > max_area_change:
        return q.astype(np.float32)
    if not cv2.isContourConvex(refined.astype(np.float32).reshape(-1, 1, 2)):
        return q.astype(np.float32)
    return order_points(refined)

"""
Stage 2 — local-feature matching (precision re-rank).

Stage 1 (pHash) narrows the whole index to a small shortlist by overall
appearance. Stage 2 confirms the *specific* card by matching local keypoint
descriptors (ORB or SIFT) between the query crop and each shortlisted
reference, then geometrically verifying the matches with a RANSAC homography.
The candidate with the most *validated* geometric inliers wins.

Design choices mirror the reference project (YAMCR) where sensible:
- **Histogram equalisation** before detection for lighting invariance.
- **Capped feature counts** to bound descriptor storage/compute.
- Descriptors are stored in the DB (not images).
We differ by using ORB/SIFT (SURF is patented and absent from pip OpenCV) and by
adding RANSAC homography verification (stronger than association-only scoring).

Homography validation (:func:`validate_homography`): the query crop and the indexed
reference are both de-skewed, portrait, frame-filling images of a card, so a true
match maps the query almost onto itself — a near-similarity with rotation ≈ 0°
(or ≈ 180° for an upside-down crop), scale ≈ 1 and no perspective. RANSAC will
happily fit a wild homography through a handful of coincidental matches on the
wrong card; rejecting those fits is what stops them counting as inliers. The
validated rotation also tells the caller whether the crop is upside down.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

import cv2
import numpy as np

from . import config


def make_detector():
    """Create the configured feature detector/descriptor.

    ORB (default) yields compact binary descriptors — small on disk and fast to
    match — which matters when the index grows to a full collection. SIFT is
    richer but stores ~16× larger float descriptors. Both ship in mainline
    OpenCV (only SURF needs the non-free contrib build).
    """
    if config.FEATURE_DETECTOR == "sift":
        return cv2.SIFT_create(nfeatures=config.SIFT_FEATURES)
    return cv2.ORB_create(nfeatures=config.ORB_FEATURES)


def _norm_type() -> int:
    """Matcher norm: Hamming for ORB's binary descriptors, L2 for SIFT's floats."""
    return cv2.NORM_L2 if config.FEATURE_DETECTOR == "sift" else cv2.NORM_HAMMING


def make_matcher() -> cv2.BFMatcher:
    """Brute-force matcher appropriate for the configured detector."""
    return cv2.BFMatcher(_norm_type())


def normalize_gray(image_bgr: np.ndarray) -> np.ndarray:
    """Grayscale + histogram equalisation (lighting normalisation)."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    return cv2.equalizeHist(gray)


def compute_descriptors(image_bgr: np.ndarray, detector=None):
    """Detect keypoints and compute descriptors for an image.

    Returns:
        ``(keypoints, descriptors)`` where ``descriptors`` is an ``(N, d)``
        array (uint8 for ORB, float32 for SIFT) or ``None`` if none were found.
    """
    detector = detector or make_detector()
    gray = normalize_gray(image_bgr)
    return detector.detectAndCompute(gray, None)


# --- (De)serialisation of features for the BYTEA columns ----------------------


def _ser_array(arr: np.ndarray | None) -> bytes | None:
    """Serialise a NumPy array to bytes (dtype/shape preserved) via ``np.save``."""
    if arr is None:
        return None
    buf = io.BytesIO()
    np.save(buf, arr, allow_pickle=False)
    return buf.getvalue()


def _deser_array(blob: bytes | None) -> np.ndarray | None:
    """Inverse of :func:`_ser_array`."""
    if blob is None:
        return None
    return np.load(io.BytesIO(bytes(blob)), allow_pickle=False)


def serialize_features(keypoints, descriptors):
    """Pack keypoint coordinates + descriptors into two BLOBs for storage.

    Only the keypoint ``(x, y)`` positions are kept (enough for homography);
    scale/orientation are discarded to save space.
    """
    if descriptors is None or len(keypoints) == 0:
        return None, None
    pts = np.array([kp.pt for kp in keypoints], dtype=np.float32)  # (N, 2)
    return _ser_array(pts), _ser_array(descriptors)


def deserialize_features(pts_blob, desc_blob):
    """Inverse of :func:`serialize_features` → ``(points, descriptors)``."""
    return _deser_array(pts_blob), _deser_array(desc_blob)


def keypoints_to_points(keypoints) -> np.ndarray | None:
    """Extract an ``(N, 2)`` float32 array of keypoint positions, or None."""
    if not keypoints:
        return None
    return np.array([kp.pt for kp in keypoints], dtype=np.float32)


# --- Homography validation ---------------------------------------------------------


def validate_homography(
    h_matrix: np.ndarray | None,
    width: int,
    height: int,
    *,
    max_area_ratio: float | None = None,
    max_center_shift: float | None = None,
    max_perspective: float | None = None,
    rotation_tol: float | None = None,
) -> tuple[bool, float | None]:
    """Sanity-check a query→candidate homography for two de-skewed card images.

    Maps the query's corners through ``h_matrix`` and requires the image to be a
    convex quad of similar area, roughly centred, with negligible perspective and a
    rotation within ``rotation_tol`` degrees of 0° or 180°.

    Returns:
        ``(ok, rotation_deg)`` where ``rotation_deg`` is the mapped top edge's
        angle in ``[0, 360)`` (None when the matrix is unusable).
    """
    max_area_ratio = max_area_ratio or config.HOMOGRAPHY_MAX_AREA_RATIO
    max_center_shift = max_center_shift or config.HOMOGRAPHY_MAX_CENTER_SHIFT
    max_perspective = max_perspective or config.HOMOGRAPHY_MAX_PERSPECTIVE
    rotation_tol = rotation_tol or config.HOMOGRAPHY_ROTATION_TOL

    if h_matrix is None or h_matrix.shape != (3, 3) or not np.all(np.isfinite(h_matrix)):
        return False, None
    if abs(h_matrix[2, 2]) < 1e-9:
        return False, None
    h_norm = h_matrix / h_matrix[2, 2]

    corners = np.float32([[0, 0], [width, 0], [width, height], [0, height]]).reshape(-1, 1, 2)
    mapped = cv2.perspectiveTransform(corners, h_norm).reshape(4, 2)
    if not np.all(np.isfinite(mapped)):
        return False, None

    top = mapped[1] - mapped[0]
    rotation = math.degrees(math.atan2(float(top[1]), float(top[0]))) % 360.0
    dist_to_axis = min(rotation, abs(rotation - 180.0), 360.0 - rotation)

    area = abs(cv2.contourArea(mapped.astype(np.float32)))
    ratio = area / float(width * height)
    center_shift = np.abs(mapped.mean(axis=0) - (width / 2.0, height / 2.0))
    ok = (
        cv2.isContourConvex(mapped.astype(np.float32))
        and (1.0 / max_area_ratio) <= ratio <= max_area_ratio
        and center_shift[0] <= max_center_shift * width
        and center_shift[1] <= max_center_shift * height
        and abs(h_norm[2, 0]) <= max_perspective
        and abs(h_norm[2, 1]) <= max_perspective
        and dist_to_axis <= rotation_tol
    )
    return bool(ok), rotation


def _homography_method() -> int:
    """OpenCV robust-estimation flag for the configured method."""
    if config.HOMOGRAPHY_METHOD == "magsac":
        return cv2.USAC_MAGSAC
    return cv2.RANSAC


# --- Scoring ---------------------------------------------------------------------


@dataclass
class MatchResult:
    """Outcome of matching one query against one candidate.

    ``inliers`` is the RANSAC inlier count *only if* the homography passed
    validation (0 otherwise), so it can be used directly as a ranking score.
    ``good`` is the ratio-test survivor count, the fallback signal when no
    (valid) homography could be fitted; ``rotation`` is the validated fit's
    rotation in degrees (≈0 or ≈180), ``None`` without a valid fit.
    """

    good: int
    inliers: int
    valid: bool
    rotation: float | None

    @property
    def score(self) -> float:
        """Ranking score: validated inliers, with good matches as a sub-unit tie-break.

        The good-match count must never compete on the inlier scale: cards that
        share a frame and fonts collect 50-80 ratio-test survivors *without* any
        geometric consistency, which would outrank a true match's 40 validated
        inliers. Dividing by 1000 keeps ``good`` (capped by the feature count,
        ≤ 500) below one inlier, so it only orders rows that tie on inliers —
        including the all-zero case of an index without descriptors, which then
        still degrades to good-match order and finally the pHash order.
        """
        return float(self.inliers) + self.good / 1000.0


def score_match_ex(q_pts, q_desc, c_pts, c_desc, matcher=None, size=None) -> MatchResult:
    """Full scoring: kNN → ratio test → RANSAC homography → validation.

    Args:
        q_pts, q_desc: query keypoint positions ``(N,2)`` and descriptors.
        c_pts, c_desc: candidate keypoint positions and descriptors.
        matcher: optional reusable :class:`cv2.BFMatcher`.
        size: ``(width, height)`` of the query image for validation; defaults to
            the standard crop size.
    """
    if q_desc is None or c_desc is None or len(q_desc) < 2 or len(c_desc) < 2:
        return MatchResult(0, 0, False, None)

    matcher = matcher or make_matcher()
    knn = matcher.knnMatch(q_desc, c_desc, k=2)

    # Lowe ratio test: keep a match only if the best neighbour is clearly closer
    # than the second-best (ambiguous matches are discarded).
    good = [
        pair[0]
        for pair in knn
        if len(pair) == 2 and pair[0].distance < config.RATIO_TEST * pair[1].distance
    ]

    # A homography needs 4 correspondences, but fitting one through fewer than
    # MIN_GOOD_MATCHES coincidental matches only produces junk inliers on wrong
    # cards (measured: ~60 of 100 shortlist rows paid for RANSAC, ~10 deserved it).
    if len(good) < max(4, config.MIN_GOOD_MATCHES):
        return MatchResult(len(good), 0, False, None)

    src = np.float32([q_pts[m.queryIdx] for m in good]).reshape(-1, 1, 2)
    dst = np.float32([c_pts[m.trainIdx] for m in good]).reshape(-1, 1, 2)
    h_matrix, mask = cv2.findHomography(
        src,
        dst,
        _homography_method(),
        5.0,
        maxIters=config.HOMOGRAPHY_MAX_ITERS,
        confidence=config.HOMOGRAPHY_CONFIDENCE,
    )
    inliers = int(mask.sum()) if mask is not None else 0
    if inliers == 0:
        return MatchResult(len(good), 0, False, None)

    width, height = size or (config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT)
    if config.HOMOGRAPHY_VALIDATE:
        valid, rotation = validate_homography(h_matrix, width, height)
        if not valid:
            return MatchResult(len(good), 0, False, rotation)
        return MatchResult(len(good), inliers, True, rotation)
    return MatchResult(len(good), inliers, True, None)


def score_match(q_pts, q_desc, c_pts, c_desc, matcher=None):
    """Score how well a query matches a candidate via descriptor + geometric checks.

    Thin wrapper over :func:`score_match_ex` kept for callers that only need the
    classic ``(score, inliers)`` pair: the inlier count is the primary score (it
    rewards *geometrically consistent* matches, not just locally similar ones);
    the good-match count is the fallback when no valid homography exists.

    Returns:
        ``(score, inliers)``; ``(0.0, 0)`` if matching isn't possible.
    """
    res = score_match_ex(q_pts, q_desc, c_pts, c_desc, matcher)
    return res.score, res.inliers

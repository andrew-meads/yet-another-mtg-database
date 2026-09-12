"""
Stage 2 — local-feature matching (precision re-rank).

Stage 1 (pHash) narrows the whole index to a small shortlist by overall
appearance. Stage 2 confirms the *specific* card by matching local keypoint
descriptors (ORB or SIFT) between the query crop and each shortlisted
reference, then geometrically verifying the matches with a RANSAC homography.
The candidate with the most geometric inliers wins.

Design choices mirror the reference project (YAMCR) where sensible:
- **Histogram equalisation** before detection for lighting invariance.
- **Capped feature counts** to bound descriptor storage/compute.
- Descriptors are stored in the DB (not images).
We differ by using ORB/SIFT (SURF is patented and absent from pip OpenCV) and by
adding RANSAC homography verification (stronger than association-only scoring).
"""

from __future__ import annotations

import io

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


# --- (De)serialisation of features for the SQLite BLOB columns ---------------

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
    return np.load(io.BytesIO(blob), allow_pickle=False)


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


def score_match(q_pts, q_desc, c_pts, c_desc, matcher=None):
    """Score how well a query matches a candidate via descriptor + geometric checks.

    Pipeline: kNN match (k=2) → Lowe ratio test → if enough good matches, fit a
    RANSAC homography and count inliers. The inlier count is the primary score
    (it rewards matches that are *geometrically consistent*, not just locally
    similar); the good-match count is the fallback when there are too few points
    to fit a homography.

    Args:
        q_pts, q_desc: query keypoint positions ``(N,2)`` and descriptors.
        c_pts, c_desc: candidate keypoint positions and descriptors.
        matcher: optional reusable :class:`cv2.BFMatcher`.

    Returns:
        ``(score, inliers)`` floats/ints; ``(0.0, 0)`` if matching isn't possible.
    """
    if q_desc is None or c_desc is None or len(q_desc) < 2 or len(c_desc) < 2:
        return 0.0, 0

    matcher = matcher or make_matcher()
    knn = matcher.knnMatch(q_desc, c_desc, k=2)

    # Lowe ratio test: keep a match only if the best neighbour is clearly closer
    # than the second-best (ambiguous matches are discarded).
    good = [
        pair[0]
        for pair in knn
        if len(pair) == 2 and pair[0].distance < config.RATIO_TEST * pair[1].distance
    ]

    # Need >= 4 correspondences to estimate a homography.
    if len(good) < 4:
        return float(len(good)), 0

    src = np.float32([q_pts[m.queryIdx] for m in good]).reshape(-1, 1, 2)
    dst = np.float32([c_pts[m.trainIdx] for m in good]).reshape(-1, 1, 2)
    _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    inliers = int(mask.sum()) if mask is not None else 0

    # Prefer the geometrically verified inlier count; fall back to good-match
    # count if the homography couldn't be estimated.
    score = float(inliers) if inliers > 0 else float(len(good))
    return score, inliers

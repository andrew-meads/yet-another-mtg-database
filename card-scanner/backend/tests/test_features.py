"""
Tests for ``app.features``: descriptor (de)serialisation, the ratio-test + RANSAC
scorer and the detector/matcher factories.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app import config, features


def _pts_and_desc(image):
    """Keypoint positions and descriptors of ``image`` with the configured detector."""
    keypoints, descriptors = features.compute_descriptors(image)
    return features.keypoints_to_points(keypoints), descriptors


# --- (de)serialisation --------------------------------------------------------------


def test_serialize_round_trip_preserves_dtype_and_shape(fake_card):
    keypoints, descriptors = features.compute_descriptors(fake_card(0))
    assert descriptors is not None and len(keypoints) > 50

    pts_blob, desc_blob = features.serialize_features(keypoints, descriptors)
    pts, desc = features.deserialize_features(pts_blob, desc_blob)

    assert isinstance(pts_blob, bytes) and isinstance(desc_blob, bytes)
    assert pts.dtype == np.float32 and pts.shape == (len(keypoints), 2)
    assert desc.dtype == descriptors.dtype and desc.shape == descriptors.shape
    assert np.array_equal(desc, descriptors)
    assert np.allclose(pts, features.keypoints_to_points(keypoints))


def test_serialize_none_passthrough():
    """Rows without features store NULL blobs and must come back as ``None``."""
    assert features.serialize_features([], None) == (None, None)
    assert features.serialize_features([], np.zeros((0, 32), np.uint8)) == (None, None)
    assert features.deserialize_features(None, None) == (None, None)
    assert features.keypoints_to_points([]) is None


# --- score_match --------------------------------------------------------------------


def test_jittered_copy_scores_at_least_min_inliers(fake_card, jitter, rng):
    """A perspective-jittered crop of the same card clears the confidence floor."""
    q_pts, q_desc = _pts_and_desc(jitter(fake_card(2), rng))
    c_pts, c_desc = _pts_and_desc(fake_card(2))

    score, inliers = features.score_match(q_pts, q_desc, c_pts, c_desc)

    assert inliers >= config.MIN_INLIERS
    # Inliers are the primary score; the good-match count only adds a sub-unit tie-break.
    assert float(inliers) <= score < inliers + 1


@pytest.mark.parametrize("query, other", [(2, 6), (6, 2), (5, 10)])
def test_unrelated_card_scores_well_below_self(fake_card, jitter, rng, query, other):
    """An unrelated card gets fewer than half the inliers the true card gets, which is
    the headroom the matcher's ``CONFIDENT_MARGIN`` (2x) relies on."""
    q_pts, q_desc = _pts_and_desc(jitter(fake_card(query), rng))
    _, self_inliers = features.score_match(q_pts, q_desc, *_pts_and_desc(fake_card(query)))
    _, other_inliers = features.score_match(q_pts, q_desc, *_pts_and_desc(fake_card(other)))

    assert self_inliers >= config.MIN_INLIERS
    assert other_inliers < self_inliers / 2


def test_score_match_handles_missing_or_short_descriptors(fake_card):
    pts, desc = _pts_and_desc(fake_card(0))

    assert features.score_match(None, None, pts, desc) == (0.0, 0)
    assert features.score_match(pts, desc, None, None) == (0.0, 0)
    # kNN with k=2 needs at least two candidates to compare against.
    assert features.score_match(pts, desc, pts[:1], desc[:1]) == (0.0, 0)
    assert features.score_match(pts[:1], desc[:1], pts, desc) == (0.0, 0)


# --- factories ----------------------------------------------------------------------


def test_default_detector_is_orb_with_hamming_matcher(monkeypatch, fake_card):
    monkeypatch.setattr(config, "FEATURE_DETECTOR", "orb")

    detector = features.make_detector()
    _, desc = features.compute_descriptors(fake_card(0), detector)

    assert isinstance(detector, cv2.ORB)
    assert desc.dtype == np.uint8  # binary descriptors
    assert features._norm_type() == cv2.NORM_HAMMING
    # A Hamming matcher accepts uint8 descriptors without complaint.
    assert len(features.make_matcher().knnMatch(desc, desc, k=2)) == len(desc)


def test_sift_setting_switches_detector_and_norm(monkeypatch, fake_card):
    """``FEATURE_DETECTOR=sift`` must swap both the detector and the matcher norm; a
    Hamming matcher would raise on SIFT's float32 descriptors."""
    monkeypatch.setattr(config, "FEATURE_DETECTOR", "sift")

    detector = features.make_detector()
    _, desc = features.compute_descriptors(fake_card(0), detector)

    assert isinstance(detector, cv2.SIFT)
    assert desc.dtype == np.float32
    assert features._norm_type() == cv2.NORM_L2
    assert len(features.make_matcher().knnMatch(desc, desc, k=2)) == len(desc)

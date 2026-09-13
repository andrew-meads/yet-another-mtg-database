"""
Tests for ``app.evaluate.distort``, the synthetic "imperfect de-skew" used by the
identification accuracy harness.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app import evaluate


@pytest.fixture
def bright_image() -> np.ndarray:
    """A card-sized image with no dark pixels of its own.

    Fake cards have a black border, which would mask the very defect this file
    checks for (a smeared/black frame added by the warp), so use bright noise.
    """
    return np.random.default_rng(1).integers(100, 256, (680, 487, 3), dtype=np.uint8)


def test_distort_keeps_shape_and_dtype(bright_image):
    out, flipped = evaluate.distort(bright_image, np.random.default_rng(0), flip_prob=0.0)

    assert out.shape == bright_image.shape
    assert out.dtype == np.uint8
    assert flipped is False


@pytest.mark.parametrize("seed", [0, 1, 2, 3, 4])
def test_distort_output_stays_frame_filling(bright_image, seed):
    """No near-black border rows/columns: the residual warp samples from INSIDE the
    card and stretches outward, so real de-skew-like output has no smeared edge."""
    out, _ = evaluate.distort(bright_image, np.random.default_rng(seed), flip_prob=0.0)

    row_means = out.mean(axis=(1, 2))
    col_means = out.mean(axis=(0, 2))
    assert row_means.min() > 60, f"dark row (min mean {row_means.min():.1f})"
    assert col_means.min() > 60, f"dark column (min mean {col_means.min():.1f})"


def test_distort_is_deterministic_per_seed(bright_image):
    first, _ = evaluate.distort(bright_image, np.random.default_rng(42), flip_prob=0.0)
    second, _ = evaluate.distort(bright_image, np.random.default_rng(42), flip_prob=0.0)
    other, _ = evaluate.distort(bright_image, np.random.default_rng(43), flip_prob=0.0)

    assert np.array_equal(first, second)
    assert not np.array_equal(first, other)


def test_distort_flip_prob_one_always_flips(bright_image):
    """``flip_prob=1.0`` reports a flip and the output is the 180° rotation of the
    otherwise identical (same seed) unflipped result."""
    upright, flipped_a = evaluate.distort(bright_image, np.random.default_rng(7), flip_prob=0.0)
    flipped, flipped_b = evaluate.distort(bright_image, np.random.default_rng(7), flip_prob=1.0)

    assert (flipped_a, flipped_b) == (False, True)
    assert np.array_equal(flipped, cv2.rotate(upright, cv2.ROTATE_180))


def test_distort_actually_changes_the_image(bright_image):
    out, _ = evaluate.distort(bright_image, np.random.default_rng(0), flip_prob=0.0)
    assert not np.array_equal(out, bright_image)

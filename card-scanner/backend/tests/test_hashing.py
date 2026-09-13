"""
Tests for ``app.hashing``: the SWAR popcount, the Hamming scan and the DCT pHash.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app import config, hashing


def test_popcount64_matches_int_bit_count(rng):
    """The vectorised SWAR popcount agrees with Python's exact answer, including the
    all-zero and all-ones words that catch carry/shift mistakes."""
    values = rng.integers(0, 2**64, size=10_000, dtype=np.uint64)
    values = np.concatenate([values, np.array([0, 2**64 - 1], dtype=np.uint64)])

    got = hashing._popcount64(values)

    expected = np.array([int(v).bit_count() for v in values], dtype=np.uint64)
    assert np.array_equal(got, expected)


def test_hamming_to_array_takes_per_row_minimum_over_variants():
    """With two query variants each DB row gets the closer of the two distances."""
    a, b = 0b1111, 0b0000
    db = np.array([a, b, 0b0011], dtype=np.uint64)

    single = hashing.hamming_to_array([a], db)
    both = hashing.hamming_to_array([a, b], db)

    assert single.tolist() == [0, 4, 2]
    assert both.tolist() == [0, 0, 2]  # row 2 is 2 bits from either variant
    assert both.dtype == np.int64


def test_hamming_to_array_with_no_variants_is_zero():
    db = np.array([1, 2, 3], dtype=np.uint64)
    assert hashing.hamming_to_array([], db).tolist() == [0, 0, 0]


def test_compute_phash_is_deterministic_and_64_bit(fake_card):
    card = fake_card(0)

    first = hashing.compute_phash(card)
    second = hashing.compute_phash(card.copy())

    assert isinstance(first, int)
    assert first == second
    assert 0 <= first < 2**64


def test_rotated_query_is_covered_by_variants(fake_card):
    """A 180° flip hashes very differently, but ``phash_query_variants`` includes it."""
    card = fake_card(1)
    flipped = cv2.rotate(card, cv2.ROTATE_180)
    db = np.array([hashing.compute_phash(card)], dtype=np.uint64)

    naive = hashing.hamming_to_array([hashing.compute_phash(flipped)], db)[0]
    covered = hashing.hamming_to_array(hashing.phash_query_variants(flipped), db)[0]

    # A card is not rotationally symmetric, so the naive distance is far from 0 and
    # would push the card out of any sensible shortlist...
    assert naive > 12
    # ...while the 180° variant is bit-identical to the stored 0° hash.
    assert covered == 0


@pytest.mark.parametrize("alpha, beta", [(1.15, 15), (0.85, -15)], ids=["brighter", "darker"])
def test_phash_is_robust_to_mild_lighting_change(fake_card, alpha, beta):
    """Global contrast/brightness shifts move only a few bits (the DCT thresholds
    against the block median, which shifts with the image)."""
    card = fake_card(2)
    adjusted = cv2.convertScaleAbs(card, alpha=alpha, beta=beta)

    distance = (hashing.compute_phash(card) ^ hashing.compute_phash(adjusted)).bit_count()

    assert distance < 10


@pytest.mark.parametrize("hash_size", [4, 8, 16])
def test_hash_size_override_sets_bit_length(fake_card, hash_size):
    """``hash_size`` n gives an n*n-bit hash. The top bit is the DC term, which always
    exceeds the block median, so the bit length is exactly n*n rather than at most."""
    value = hashing.compute_phash(fake_card(3), hash_size=hash_size)
    assert value.bit_length() == hash_size * hash_size


def test_highfreq_factor_override_keeps_64_bits_and_similar_hash(fake_card):
    """A different DCT working resolution still yields a 64-bit hash of the same
    gross layout (the low-frequency block barely depends on the resize target)."""
    card = fake_card(4)
    default = hashing.compute_phash(card)
    coarse = hashing.compute_phash(card, highfreq_factor=2)
    fine = hashing.compute_phash(card, highfreq_factor=8)

    assert config.PHASH_HIGHFREQ_FACTOR not in (2, 8)  # the overrides really differ
    for value in (coarse, fine):
        assert value.bit_length() == 64
        assert (value ^ default).bit_count() <= 8

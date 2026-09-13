"""
Stage 1 — perceptual hashing (DCT pHash).

A perceptual hash maps an image to a compact bit string such that *visually
similar* images get *similar* hashes (small Hamming distance) — the opposite of
a cryptographic hash. We use the classic DCT pHash: shrink to a small square,
take the 2-D Discrete Cosine Transform, keep the low-frequency top-left block
(overall structure, discarding noisy fine detail), and threshold each
coefficient against the block's median to get one bit.

This module also provides a fully vectorised Hamming-distance routine over a
NumPy array of 64-bit hashes, used to rank the whole index in Stage 1.

No third-party hashing dependency: the DCT is `cv2.dct` (already available via
OpenCV), so we avoid pulling in `imagehash`/`scipy`.
"""

from __future__ import annotations

import cv2
import numpy as np

from . import config

# --- Vectorised 64-bit popcount (SWAR) --------------------------------------
# These constants implement the well-known "parallel bit count" trick on whole
# NumPy uint64 arrays at once, which is byte-order independent (unlike viewing
# the array as bytes). Used to count differing bits after an XOR.
_M1 = np.uint64(0x5555555555555555)
_M2 = np.uint64(0x3333333333333333)
_M4 = np.uint64(0x0F0F0F0F0F0F0F0F)
_H01 = np.uint64(0x0101010101010101)
_S1 = np.uint64(1)
_S2 = np.uint64(2)
_S4 = np.uint64(4)
_S56 = np.uint64(56)


def _popcount64(x: np.ndarray) -> np.ndarray:
    """Count set bits in every element of a uint64 array (vectorised)."""
    x = x.astype(np.uint64)
    x = x - ((x >> _S1) & _M1)
    x = (x & _M2) + ((x >> _S2) & _M2)
    x = (x + (x >> _S4)) & _M4
    return (x * _H01) >> _S56


def compute_phash(
    image_bgr: np.ndarray,
    hash_size: int | None = None,
    highfreq_factor: int | None = None,
) -> int:
    """Compute the DCT perceptual hash of a BGR image.

    Args:
        image_bgr: Image in BGR channel order.
        hash_size: Side length of the kept low-frequency block; the hash has
            ``hash_size**2`` bits (default from config → 8 → 64-bit).
        highfreq_factor: The image is resized to ``hash_size*highfreq_factor``
            square before the DCT.

    Returns:
        The hash as a Python int in ``[0, 2**(hash_size**2))``.
    """
    hash_size = hash_size or config.PHASH_SIZE
    highfreq_factor = highfreq_factor or config.PHASH_HIGHFREQ_FACTOR
    img_size = hash_size * highfreq_factor

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    # INTER_AREA is the best filter for heavy downscaling.
    small = cv2.resize(gray, (img_size, img_size), interpolation=cv2.INTER_AREA)

    # 2-D DCT (cv2.dct works on float32). The top-left block holds the lowest
    # spatial frequencies — the card's gross layout/composition.
    dct = cv2.dct(small.astype(np.float32))
    low = dct[:hash_size, :hash_size]

    # Threshold each low-frequency coefficient against the block median. The
    # [0,0] DC term (overall brightness) is one extreme value and barely shifts
    # the median, so we keep the standard "median of the whole block" rule.
    med = float(np.median(low))
    bits = (low > med).flatten().astype(np.uint8)

    # Pack the bits (MSB first) into an integer.
    return int.from_bytes(np.packbits(bits).tobytes(), "big")


def phash_query_variants(image_bgr: np.ndarray) -> list[int]:
    """Return the query's pHash at 0° and 180°.

    Part 1 normalises crops to portrait but cannot guarantee "upright", so an
    upside-down card would hash completely differently. We therefore hash both
    orientations on the *query* side and let the matcher take whichever is
    closer (the index only stores the 0° hash — same idea as the reference
    project's `compareHashWithFlip`).
    """
    return [
        compute_phash(image_bgr),
        compute_phash(cv2.rotate(image_bgr, cv2.ROTATE_180)),
    ]


def hamming_to_array(query_hashes: list[int], db: np.ndarray) -> np.ndarray:
    """Min Hamming distance from each DB hash to the closest query variant.

    Args:
        query_hashes: One or more query hashes (e.g. 0° and 180°).
        db: 1-D ``uint64`` array of indexed hashes.

    Returns:
        ``int64`` array of per-row minimum Hamming distances.
    """
    db = db.astype(np.uint64)
    best: np.ndarray | None = None
    for q in query_hashes:
        dist = _popcount64(db ^ np.uint64(q))
        best = dist if best is None else np.minimum(best, dist)
    if best is None:
        return np.zeros(len(db), dtype=np.int64)
    return best.astype(np.int64)


def mask_glare(
    image_bgr: np.ndarray,
    *,
    value_thresh: int = 245,
    saturation_thresh: int = 40,
    max_area: float = 0.15,
    radius: int = 3,
) -> np.ndarray:
    """Inpaint specular glare (bright, colourless blobs) before hashing a query.

    Foil cards and glossy sleeves reflect the light source as saturated white
    patches that dominate a low-frequency hash. Pixels that are both very bright
    (V) and colourless (low S) are inpainted from their surroundings. If the mask
    would cover more than ``max_area`` of the image the card itself is probably
    just bright (a white-bordered card, a white frame), so the image is returned
    untouched rather than smeared.
    """
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    mask = ((hsv[..., 2] >= value_thresh) & (hsv[..., 1] <= saturation_thresh)).astype(np.uint8)
    if mask.sum() == 0 or mask.mean() > max_area:
        return image_bgr
    mask = cv2.dilate(mask * 255, np.ones((3, 3), np.uint8), iterations=1)
    return cv2.inpaint(image_bgr, mask, radius, cv2.INPAINT_TELEA)

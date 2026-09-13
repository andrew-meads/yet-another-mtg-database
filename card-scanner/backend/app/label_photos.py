"""
Draft, import, validate and verify ground-truth labels for real test photos.

The manifest (``test-images/test-images.json``, see :mod:`app.labels`) is
hand-authored: the user lists which cards are in each photo. This tool adds the
*machine-assisted* fields — chiefly the ``quad`` of every card in printed
order — so that :mod:`app.evaluate_photos` can score detection as well as
identification. It never rewrites a human-written value.

Usage (from ``card-scanner/backend``)::

    # Draft quads for every entry that is not yet verified (needs Postgres for
    # identity-based assignment; --no-identify falls back to list order).
    python -m app.label_photos [DATASET]

    # Look at DATASET/_overlays/<stem>.draft.jpg, fix anything wrong by hand,
    # then promote the entries' quads to "verified":
    python -m app.label_photos --verify 01,02,03

    # Import a new phone photo (EXIF-baked, downscaled, EXIF stripped) and
    # append a manifest entry with an empty card list for the user to fill in:
    python -m app.label_photos --import ~/Downloads/IMG_1234.jpg --slug wood-dark-3cards \\
        --background wood-dark --tags sleeved,tilt --lighting "warm lamp"

    # Offline structure check (exit 1 on problems); --resolve also resolves
    # every card against the index and lists the fuzzy/unresolved ones.
    python -m app.label_photos --validate [--resolve]

    # Snap every unverified quad (of entries 15 and 16, or all with no list)
    # onto the card's Scryfall reference image: a SIFT homography fitted
    # inside the quad's own warp projects the reference corners back into the
    # photo. Rough hand-typed quads (any corner order) become precise,
    # printed-order quads — the way to label cards the detector cannot find.
    python -m app.label_photos --refine [15,16] [--force]

Refining (``--refine``) is independent of the detector: the card's identity
comes from the manifest (resolved against the index like ``--validate
--resolve``), its ``normal`` Scryfall image is matched into a warp of the
current quad with SIFT + MAGSAC, and the reference's four corners are mapped
back through both transforms. It is rejected — the quad is left alone and
reported — when too few matches survive, when fewer than
``REFINE_MIN_INLIERS`` correspondences agree with the homography, or when a
corner would move by more than ``REFINE_MAX_SHIFT`` of the card's short side
(a fit that locked onto a neighbouring card of the same frame). Occluded
corners are fine: the homography is fitted on the visible part and the
hidden corners follow from it.

Drafting works like this for each entry: run the current detector
(``detect_and_deskew``), identify each crop (top-1), decide whether the crop
came out upside down by comparing the crop's 0°/180° pHashes to the matched
row's stored hash, convert the geometric quad to **printed order**, and then
assign detections to the entry's listed cards **by identity** (Scryfall id,
then oracle id) — not by list order, because the detector's order (largest
first) has nothing to do with the user's order. Only when identities cannot
decide are the leftovers paired in list order, and those are flagged.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from . import config, detection, geometry, hashing, labels

DEFAULT_DATASET = Path(__file__).resolve().parents[2] / "test-images"
OVERLAY_DIRNAME = "_overlays"
OVERLAY_WIDTH = 1600
IMPORT_LONG_EDGE = 3000
IMPORT_JPEG_QUALITY = 85

# --refine: SIFT + MAGSAC fit of the Scryfall reference into the quad's warp.
REFINE_FEATURES = 4000  # SIFT keypoints per image (ORB's 500 were too few on half-covered cards)
REFINE_RATIO = 0.75  # Lowe ratio for the kNN matches
REFINE_RANSAC_PX = 3.0  # MAGSAC reprojection threshold in crop pixels
REFINE_MIN_MATCHES = 12  # ratio-test survivors needed before fitting at all
REFINE_MIN_INLIERS = 40  # validated correspondences a fit must have to be trusted
REFINE_MAX_SHIFT = 0.15  # a corner may move at most this fraction of the card's short side
REFINE_UNCHANGED_PX = 2.0  # moves below this are reported as unchanged (and not written)


# --------------------------------------------------------------------------
# Detection + identification helpers
# --------------------------------------------------------------------------


def _fetch_phash(scryfall_id: str, face: str | None) -> int | None:
    """Read one indexed row's 64-bit pHash (stored as 8 big-endian bytes)."""
    from . import index_db

    with index_db.connection() as conn:
        row = conn.execute(
            "SELECT phash FROM cards WHERE scryfall_id = %s AND face IS NOT DISTINCT FROM %s",
            (scryfall_id, face),
        ).fetchone()
    if row is None:
        return None
    return int.from_bytes(bytes(row["phash"]), "big")


def crop_is_flipped(crop_bgr: np.ndarray, reference_hash: int) -> bool:
    """Whether a portrait crop is upside down relative to its indexed reference.

    The index stores only the 0° hash; the matcher tolerates 180° flips by
    hashing both query variants and taking the closer one. Reusing that here
    tells us which variant won — if the 180° variant is strictly closer, the
    crop (and therefore the printed top-left) is at the bottom-right.
    """
    h0, h180 = hashing.phash_query_variants(crop_bgr)
    d0 = int(hashing.hamming_to_array([h0], np.array([reference_hash], dtype=np.uint64))[0])
    d180 = int(hashing.hamming_to_array([h180], np.array([reference_hash], dtype=np.uint64))[0])
    return d180 < d0


def detect_cards(image_bgr: np.ndarray, identify: bool) -> list[dict]:
    """Run the detector (and optionally top-1 identification) on one photo.

    Returns one dict per detection: ``quad_geometric`` (order_points output),
    ``landscape`` (whether the warp came out wider than tall, i.e. it was
    rotated 90° CW to portrait), ``top1`` (the matcher's best result or None),
    ``flipped`` (printed top is opposite the geometric top: the detector's own
    rotation combined with what identification saw) and ``quad``
    (printed order).
    """
    cards = detection.detect_and_deskew(image_bgr)
    out: list[dict] = []
    for det in cards:
        quad_geo = geometry.order_points(det.quad)
        w, h = geometry.warp_size(quad_geo)
        landscape = w > h
        top1 = None
        # The detector already rotates the crop by the pHash variant that matched
        # best (``det.orientation``); identification then reports whether the crop
        # it saw is *still* upside down (validated homography first, OCR line
        # classifier second). The printed order needs the total rotation.
        flipped = int(getattr(det, "orientation", 0) or 0) == 180
        if identify:
            from . import matcher

            cv2.setRNGSeed(0)  # reproducible RANSAC → reproducible drafts
            ident = matcher.identify_card(det.image, 1, ocr_image=getattr(det, "ocr_image", None))
            top1 = ident.matches[0] if ident.matches else None
            still_flipped = None
            if ident.orientation is not None:
                still_flipped = ident.orientation == 180
            elif top1 is not None:
                ref = _fetch_phash(top1["scryfallId"], top1.get("face"))
                if ref is not None:
                    still_flipped = crop_is_flipped(det.image, ref)
            if still_flipped:
                flipped = not flipped
        out.append(
            {
                "quad_geometric": quad_geo,
                "landscape": landscape,
                "top1": top1,
                "flipped": flipped,
                "quad": labels.printed_order_from_detection(quad_geo, landscape, flipped),
            }
        )
    return out


def assign_detections(
    detections: list[dict], cards: list[dict], maps: labels.IndexMaps | None
) -> tuple[list[tuple[int, int, str]], list[int], list[int]]:
    """Pair detections with manifest cards by identity, then by list order.

    Returns ``(pairs, unassigned_detections, unassigned_cards)`` where each pair
    is ``(detection_index, card_index, how)`` and ``how`` is ``scryfall_id``,
    ``oracle_id`` or ``order`` (the flagged last resort).
    """
    pairs: list[tuple[int, int, str]] = []
    free_det = list(range(len(detections)))
    free_card = list(range(len(cards)))

    if maps is not None:
        resolutions = [labels.resolve_expected(c, maps) for c in cards]
        # Pass 1: exact printing. Pass 2: same card, any printing.
        for how in ("scryfall_id", "oracle_id"):
            for di in list(free_det):
                top1 = detections[di]["top1"]
                if top1 is None:
                    continue
                det_sid = top1["scryfallId"]
                det_key = det_sid if how == "scryfall_id" else maps.oracle_of(det_sid)
                for ci in list(free_card):
                    res = resolutions[ci]
                    exp_key = res.scryfall_id if how == "scryfall_id" else res.oracle_id
                    if exp_key is not None and det_key == exp_key:
                        pairs.append((di, ci, how))
                        free_det.remove(di)
                        free_card.remove(ci)
                        break

    # Last resort: whatever is left, in order. Flagged so the user checks it.
    while free_det and free_card:
        pairs.append((free_det.pop(0), free_card.pop(0), "order"))
    return pairs, free_det, free_card


# --------------------------------------------------------------------------
# Reference-image refinement
# --------------------------------------------------------------------------


@dataclass
class RefineResult:
    """Outcome of :func:`refine_quad_from_reference` for one card.

    ``quad`` is the refined quad in printed order (``None`` when the fit was
    rejected, in which case ``reason`` says why), ``good`` / ``inliers`` are the
    ratio-test survivors and the homography's validated correspondences, and
    ``shift_px`` is how far the refined corners sit from the input quad's
    corners (order-agnostic: each refined corner against its nearest input
    corner, so a rough quad typed in the wrong order still measures small).
    """

    quad: np.ndarray | None
    good: int
    inliers: int
    shift_px: float
    reason: str | None = None


def _corner_shift(refined: np.ndarray, rough: np.ndarray) -> float:
    """Largest distance from a refined corner to the nearest rough corner."""
    d = np.linalg.norm(refined[:, None, :] - rough[None, :, :], axis=2)
    return float(d.min(axis=1).max())


def refine_quad_from_reference(
    image_bgr: np.ndarray,
    quad: np.ndarray | list,
    reference_bgr: np.ndarray,
    *,
    min_inliers: int = REFINE_MIN_INLIERS,
    max_shift: float = REFINE_MAX_SHIFT,
) -> RefineResult:
    """Snap ``quad`` onto the card by matching its Scryfall reference image.

    The photo region inside ``quad`` (any corner order) is warped to the
    standard crop size, SIFT features are matched against the reference
    (resized to the same size), a homography *reference → crop* is fitted with
    MAGSAC, and the reference image's four corners are mapped through it and
    then back through the inverse warp into photo coordinates. Because the
    reference's corner 0 is the printed top-left, the result is in printed
    order whatever order ``quad`` came in.

    The fit is rejected (``quad=None``) when fewer than ``REFINE_MIN_MATCHES``
    matches survive the ratio test, when the homography has fewer than
    ``min_inliers`` inliers, when the projected quad is not a convex
    quadrilateral, or when a corner moves by more than ``max_shift`` of the
    input quad's short side — the signature of a fit that locked onto a
    neighbouring card with the same frame.
    """
    q = geometry._as_quad(quad).astype(np.float32)
    width, height = config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT
    rect = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    to_crop = cv2.getPerspectiveTransform(q, rect)
    crop = cv2.warpPerspective(image_bgr, to_crop, (width, height))
    ref = cv2.resize(reference_bgr, (width, height), interpolation=cv2.INTER_AREA)

    sift = cv2.SIFT_create(nfeatures=REFINE_FEATURES)
    k_crop, d_crop = sift.detectAndCompute(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), None)
    k_ref, d_ref = sift.detectAndCompute(cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY), None)
    if d_crop is None or d_ref is None or len(d_crop) < 2 or len(d_ref) < 2:
        return RefineResult(None, 0, 0, 0.0, "no features")

    knn = cv2.BFMatcher(cv2.NORM_L2).knnMatch(d_crop, d_ref, k=2)
    good = [p[0] for p in knn if len(p) == 2 and p[0].distance < REFINE_RATIO * p[1].distance]
    if len(good) < REFINE_MIN_MATCHES:
        return RefineResult(None, len(good), 0, 0.0, f"only {len(good)} matches")

    src = np.float32([k_ref[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([k_crop[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    cv2.setRNGSeed(0)  # reproducible MAGSAC → reproducible quads
    h_matrix, mask = cv2.findHomography(
        src, dst, cv2.USAC_MAGSAC, REFINE_RANSAC_PX, maxIters=5000, confidence=0.999
    )
    inliers = int(mask.sum()) if mask is not None else 0
    if h_matrix is None or inliers < min_inliers:
        return RefineResult(None, len(good), inliers, 0.0, f"only {inliers} inliers")

    in_crop = cv2.perspectiveTransform(rect.reshape(-1, 1, 2), h_matrix)
    refined = cv2.perspectiveTransform(in_crop, np.linalg.inv(to_crop)).reshape(4, 2)
    if not np.all(np.isfinite(refined)) or not labels._is_convex_quad(refined):
        return RefineResult(None, len(good), inliers, 0.0, "projected quad is not convex")

    shift = _corner_shift(refined, q)
    short_side = float(min(np.linalg.norm(q[i] - q[(i + 1) % 4]) for i in range(4)))
    if shift > max_shift * short_side:
        return RefineResult(
            None,
            len(good),
            inliers,
            shift,
            f"corner moved {shift:.0f} px (> {max_shift:.0%} of the card's short side)",
        )
    return RefineResult(refined.astype(np.float32), len(good), inliers, shift)


def _load_reference(scryfall_id: str, face: str | None) -> np.ndarray | None:
    """The indexed face's ``normal`` Scryfall image (cache first, then Scryfall)."""
    from . import image_cache, index_db

    with index_db.connection() as conn:
        row = conn.execute(
            "SELECT face, image_url FROM cards WHERE scryfall_id = %s AND face IS NOT DISTINCT FROM %s",
            (scryfall_id, face),
        ).fetchone()
    if row is None:
        return None
    return image_cache.get_image(
        scryfall_id, row["face"] or "front", row["image_url"], fmt="normal"
    )


# --------------------------------------------------------------------------
# Overlay
# --------------------------------------------------------------------------

_COLOURS = {
    "scryfall_id": (0, 200, 0),  # green: assigned by exact printing
    "oracle_id": (0, 200, 200),  # yellow: assigned by card identity only
    "order": (0, 140, 255),  # orange: list-order fallback — check by eye
    "unassigned": (0, 0, 230),  # red: detection matched no listed card
}


def _overlay_canvas(image_bgr: np.ndarray) -> tuple[np.ndarray, float]:
    """The photo downscaled to ``OVERLAY_WIDTH`` and the scale that was applied."""
    h, w = image_bgr.shape[:2]
    scale = min(1.0, OVERLAY_WIDTH / w)
    canvas = cv2.resize(
        image_bgr, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA
    )
    return canvas, scale


def _draw_quad(
    canvas: np.ndarray, quad: np.ndarray, colour: tuple[int, int, int], text: str, thickness: int
) -> None:
    """One quad (already in canvas coordinates), corners numbered 1–4, label at corner 1."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    pts = quad.astype(np.int32).reshape(-1, 1, 2)
    cv2.polylines(canvas, [pts], isClosed=True, color=colour, thickness=thickness)
    for k, (x, y) in enumerate(quad, start=1):
        centre = (int(x), int(y))
        cv2.circle(canvas, centre, thickness * 6, colour, -1)
        cv2.putText(canvas, str(k), centre, font, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
    # Label next to corner 1 so number and name are read together.
    x, y = quad[0]
    cv2.putText(canvas, text, (int(x) + 12, int(y) - 12), font, 0.7, colour, 2, cv2.LINE_AA)


def draw_overlay(
    image_bgr: np.ndarray,
    detections: list[dict],
    cards: list[dict],
    pairs: list[tuple[int, int, str]],
    unassigned: list[int],
) -> np.ndarray:
    """Downscaled overlay: each quad, corners numbered 1–4 (1 = printed TL), card name."""
    canvas, scale = _overlay_canvas(image_bgr)
    thickness = max(2, canvas.shape[0] // 500)

    def draw(di: int, colour: tuple[int, int, int], text: str) -> None:
        _draw_quad(canvas, detections[di]["quad"] * scale, colour, text, thickness)

    for di, ci, how in pairs:
        name = str(cards[ci].get("name", "?"))
        draw(di, _COLOURS[how], name if how != "order" else f"{name} (by order!)")
    for di in unassigned:
        top1 = detections[di]["top1"]
        label = (
            f"unlisted: {top1['name']} {top1['set']}:{top1['collectorNumber']}"
            if top1
            else "unlisted"
        )
        draw(di, _COLOURS["unassigned"], label)
    return canvas


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------


def draft(root: Path, entries: list[dict], *, force: bool, identify: bool) -> int:
    """Draft quads for entries that are not yet verified. Returns the number of problems."""
    maps = None
    if identify:
        maps = labels.IndexMaps.load()
        print(f"index: {maps.size} rows")
    overlay_dir = root / OVERLAY_DIRNAME
    overlay_dir.mkdir(parents=True, exist_ok=True)
    problems = 0

    for entry in entries:
        file_name = entry["fileName"]
        cards = entry.get("cards", [])
        if labels.entry_kind(entry) == "crop":
            continue  # the whole file is the card; nothing to draft
        if cards and all(labels.is_verified(c) for c in cards) and not force:
            print(f"{file_name}: all {len(cards)} quads verified — skipped (use --force)")
            continue

        image = detection.load_image_bgr((root / file_name).read_bytes())
        detections = detect_cards(image, identify)
        pairs, unassigned, missing = assign_detections(detections, cards, maps)

        for di, ci, _how in pairs:
            card = cards[ci]
            if labels.is_verified(card) and not force:
                continue
            card["quad"] = labels.quad_to_json(detections[di]["quad"])
            card["quadSource"] = "draft"

        overlay = draw_overlay(image, detections, cards, pairs, unassigned)
        overlay_path = overlay_dir / f"{Path(file_name).stem}.draft.jpg"
        cv2.imwrite(str(overlay_path), overlay, [cv2.IMWRITE_JPEG_QUALITY, 85])

        by_order = [p for p in pairs if p[2] == "order"]
        status = f"{len(pairs)}/{len(cards)} cards drafted from {len(detections)} detections"
        if by_order:
            status += f"; {len(by_order)} paired by list order (CHECK)"
            problems += len(by_order)
        if unassigned:
            status += f"; {len(unassigned)} detections match no listed card"
            problems += len(unassigned)
        if missing:
            names = ", ".join(str(cards[i].get("name")) for i in missing)
            status += f"; not detected: {names}"
            problems += len(missing)
        print(f"{file_name}: {status} → {overlay_path.relative_to(root.parent)}")
    return problems


def _wanted_prefixes(prefixes: list[str] | None) -> set[str] | None:
    """Normalise ``NN`` prefixes (``01`` and ``1`` are the same entry); ``None`` means all."""
    if prefixes is None:
        return None
    return {p.strip().lstrip("0") or "0" for p in prefixes if p.strip()}


def refine(
    root: Path,
    entries: list[dict],
    prefixes: list[str] | None,
    *,
    force: bool,
    maps: labels.IndexMaps,
    load_reference: Callable[[str, str | None], np.ndarray | None] = _load_reference,
) -> int:
    """Snap the quads of the selected entries onto their reference images.

    Every card that carries a quad is refined unless it is verified (``force``
    re-refines those too); cards without a quad are reported, since a rough
    quad is the starting point. Refined quads are written as ``draft`` for the
    usual overlay check and ``--verify``. An overlay ``<stem>.refine.jpg``
    draws the old quad in red and the new one in green. Returns the number
    of things to check (rejected fits, unresolved cards, missing quads).
    """
    wanted = _wanted_prefixes(prefixes)
    overlay_dir = root / OVERLAY_DIRNAME
    overlay_dir.mkdir(parents=True, exist_ok=True)
    problems = 0
    found: set[str] = set()

    for entry in entries:
        prefix = labels.entry_prefix(entry)
        key = (prefix or "").lstrip("0") or "0"
        if wanted is not None and (prefix is None or key not in wanted):
            continue
        found.add(key)
        if labels.entry_kind(entry) == "crop":
            continue
        file_name = entry["fileName"]
        cards = entry.get("cards", [])
        image = None
        canvas = scale = None
        thickness = 2
        changed = 0
        for card in cards:
            name = str(card.get("name", "?"))
            if card.get("quad") is None:
                print(f"{file_name}: {name!r} has no quad to refine (type a rough one first)")
                problems += 1
                continue
            if labels.is_verified(card) and not force:
                continue
            res = labels.resolve_expected(card, maps)
            if res.row is None:
                print(f"{file_name}: {name!r} unresolved — {res.warning}")
                problems += 1
                continue
            reference = load_reference(res.row.scryfall_id, res.row.face)
            if reference is None:
                print(f"{file_name}: {name!r} has no reference image ({res.row.scryfall_id})")
                problems += 1
                continue
            if image is None:
                image = detection.load_image_bgr((root / file_name).read_bytes())
                canvas, scale = _overlay_canvas(image)
                thickness = max(2, canvas.shape[0] // 500)
            old = labels.card_quad(card)
            result = refine_quad_from_reference(image, old, reference)
            if result.quad is None:
                print(f"{file_name}: {name!r} kept — {result.reason} (inliers {result.inliers})")
                _draw_quad(canvas, old * scale, _COLOURS["unassigned"], f"{name} (kept)", thickness)
                problems += 1
                continue
            _draw_quad(canvas, old * scale, _COLOURS["unassigned"], "", thickness)
            _draw_quad(canvas, result.quad * scale, _COLOURS["scryfall_id"], name, thickness)
            if result.shift_px < REFINE_UNCHANGED_PX and np.array_equal(
                labels.quad_to_json(result.quad), card["quad"]
            ):
                print(f"{file_name}: {name!r} unchanged (inliers {result.inliers})")
                continue
            card["quad"] = labels.quad_to_json(result.quad)
            card["quadSource"] = "draft"
            changed += 1
            print(
                f"{file_name}: {name!r} refined — moved {result.shift_px:.0f} px "
                f"(inliers {result.inliers})"
            )
        if canvas is not None:
            overlay_path = overlay_dir / f"{Path(file_name).stem}.refine.jpg"
            cv2.imwrite(str(overlay_path), canvas, [cv2.IMWRITE_JPEG_QUALITY, 85])
            print(
                f"{file_name}: {changed} quad(s) refined → {overlay_path.relative_to(root.parent)}"
            )

    for key in sorted((wanted or set()) - found):
        print(f"no entry with prefix {key}")
        problems += 1
    return problems


def verify(entries: list[dict], prefixes: list[str]) -> int:
    """Flip the quads of the entries with the given ``NN`` prefixes to ``verified``."""
    problems = 0
    wanted = _wanted_prefixes(prefixes) or set()
    found: set[str] = set()
    for entry in entries:
        prefix = labels.entry_prefix(entry)
        key = (prefix or "").lstrip("0") or "0"
        if prefix is None or key not in wanted:
            continue
        found.add(key)
        for card in entry.get("cards", []):
            if card.get("quad") is None:
                print(f"{entry['fileName']}: {card.get('name')!r} has no quad to verify")
                problems += 1
                continue
            card["quadSource"] = "verified"
        print(f"{entry['fileName']}: verified")
    for key in sorted(wanted - found):
        print(f"no entry with prefix {key}")
        problems += 1
    return problems


def next_prefix(entries: list[dict]) -> str:
    """The next two-digit ``NN-`` prefix after the highest one in the manifest."""
    highest = 0
    for entry in entries:
        prefix = labels.entry_prefix(entry)
        if prefix is not None:
            highest = max(highest, int(prefix))
    return f"{highest + 1:02d}"


def import_photo(
    root: Path,
    entries: list[dict],
    src: Path,
    slug: str,
    *,
    background: str | None,
    tags: list[str] | None,
    lighting: str | None,
) -> str:
    """Copy ``src`` into the dataset as ``NN-slug.jpg`` and append a manifest entry.

    The photo is EXIF-transposed (so the stored pixels are upright and later
    quads never depend on a viewer honouring EXIF), downscaled to a 3000 px
    long edge, re-encoded as JPEG q85, and written without EXIF (no GPS or
    device data in the repo).
    """
    from PIL import Image, ImageOps

    slug = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")
    if not slug:
        raise ValueError("--slug must contain at least one letter or digit")
    file_name = f"{next_prefix(entries)}-{slug}.jpg"
    dest = root / file_name
    if dest.exists():
        raise FileExistsError(dest)

    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        long_edge = max(im.size)
        if long_edge > IMPORT_LONG_EDGE:
            f = IMPORT_LONG_EDGE / long_edge
            im = im.resize((round(im.width * f), round(im.height * f)), Image.Resampling.LANCZOS)
        im.save(dest, "JPEG", quality=IMPORT_JPEG_QUALITY, optimize=True)  # no exif= → stripped

    entry: dict = {"fileName": file_name, "description": "", "cards": []}
    if background:
        entry["background"] = background
    if tags:
        entry["tags"] = tags
    if lighting:
        entry["lighting"] = lighting
    entries.append(entry)
    return file_name


def validate(root: Path, entries: list[dict], *, resolve: bool) -> int:
    """Print structural problems (and, with ``resolve``, resolution warnings). Returns a count."""
    problems = labels.validate_manifest(entries, root)
    for p in problems:
        print(f"  ! {p}")
    if resolve:
        maps = labels.IndexMaps.load()
        for entry in entries:
            for card in entry.get("cards", []):
                res = labels.resolve_expected(card, maps)
                if not res.resolved:
                    problems.append(res.warning or "unresolved")
                    print(f"  ! {entry['fileName']}: {res.warning}")
                elif res.warning:
                    print(f"  ~ {entry['fileName']}: {res.warning}")
    print(
        f"{len(entries)} entries, {sum(len(e.get('cards', [])) for e in entries)} cards, "
        f"{len(problems)} problem(s)"
    )
    return len(problems)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.label_photos",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "dataset",
        nargs="?",
        default=str(DEFAULT_DATASET),
        help="dataset directory (holds test-images.json) or the manifest path",
    )
    parser.add_argument(
        "--import",
        dest="import_src",
        metavar="SRC",
        help="import a photo into the dataset (requires --slug)",
    )
    parser.add_argument("--slug", help="short name for the imported photo (NN-<slug>.jpg)")
    parser.add_argument("--background", help="background label for the imported entry")
    parser.add_argument("--tags", help="comma-separated tags for the imported entry")
    parser.add_argument("--lighting", help="lighting note for the imported entry")
    parser.add_argument("--validate", action="store_true", help="offline structure check")
    parser.add_argument(
        "--resolve",
        action="store_true",
        help="with --validate: also resolve every card against the index",
    )
    parser.add_argument(
        "--verify", metavar="NN[,NN...]", help="mark these entries' quads as verified"
    )
    parser.add_argument(
        "--refine",
        metavar="NN[,NN...]",
        nargs="?",
        const="",
        help=(
            "snap these entries' quads (all entries with no list) onto their Scryfall reference "
            "images; verified quads are left alone unless --force"
        ),
    )
    parser.add_argument(
        "--force", action="store_true", help="re-draft / re-refine verified entries too"
    )
    parser.add_argument(
        "--no-identify",
        action="store_true",
        help="draft without Postgres (assign by list order only)",
    )
    args = parser.parse_args(argv)

    root = labels.dataset_dir(args.dataset)
    try:
        entries = labels.load_manifest(args.dataset)
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.import_src:
        if not args.slug:
            parser.error("--import requires --slug")
        tags = [t.strip() for t in (args.tags or "").split(",") if t.strip()]
        try:
            name = import_photo(
                root,
                entries,
                Path(args.import_src),
                args.slug,
                background=args.background,
                tags=tags or None,
                lighting=args.lighting,
            )
        except (OSError, ValueError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        labels.save_manifest(entries, args.dataset)
        print(
            f"imported {name}; fill in its 'description' and 'cards' in {labels.manifest_path(args.dataset)}"
        )
        return 0

    if args.validate:
        return 1 if validate(root, entries, resolve=args.resolve) else 0

    if args.verify:
        problems = verify(entries, args.verify.split(","))
        labels.save_manifest(entries, args.dataset)
        return 1 if problems else 0

    if args.refine is not None:
        problems = validate(root, entries, resolve=False)
        if problems:
            print("fix the manifest before refining", file=sys.stderr)
            return 1
        prefixes = args.refine.split(",") if args.refine else None
        problems = refine(root, entries, prefixes, force=args.force, maps=labels.IndexMaps.load())
        labels.save_manifest(entries, args.dataset)
        print(f"saved {labels.manifest_path(args.dataset)} · {problems} thing(s) to check")
        return 1 if problems else 0

    problems = validate(root, entries, resolve=False)
    if problems:
        print("fix the manifest before drafting", file=sys.stderr)
        return 1
    problems = draft(root, entries, force=args.force, identify=not args.no_identify)
    labels.save_manifest(entries, args.dataset)
    print(f"saved {labels.manifest_path(args.dataset)} · {problems} thing(s) to check")
    return 0


def _cli() -> int:
    """``main`` plus an orderly pool shutdown.

    Python 3.14 refuses to join threads during interpreter finalisation, so a
    psycopg pool that is still open at exit prints a noisy (harmless)
    ``PythonFinalizationError`` traceback; closing it explicitly avoids that.
    """
    try:
        return main(sys.argv[1:])
    finally:
        from . import index_db

        index_db.close_pool()


if __name__ == "__main__":
    raise SystemExit(_cli())

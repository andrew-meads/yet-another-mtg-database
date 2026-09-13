"""
Text metadata for one indexed card face, derived from Scryfall card JSON.

The identification index stores, per face row, a set of normalised text columns
(``name_key``, ``face_name_keys``, ``collector_number_norm`` / ``_base``, …)
that let an OCR'd name or collector line be turned into candidate rows. This
module is the *single* place those columns are derived, shared by
``app.build_index`` (freshly indexed sets) and ``app.backfill_metadata``
(existing rows, from the bulk JSONL), so the two can never disagree about what
a key looks like.

The face model mirrors ``build_index._faces_for``: a card with a top-level
``image_uris`` is one ``"single"`` face (this includes split, adventure, flip
and other multi-name cards rendered on one image), while a true double-faced
card yields ``"front"`` / ``"back"`` rows from ``card_faces[0]`` / ``[1]``.
Scryfall field reference: https://scryfall.com/docs/api/cards
"""

from __future__ import annotations

from . import names

FACE_LABELS = ("single", "front", "back")


def _face_field(face: dict, card: dict, field: str):
    """A face-level field, falling back to the card level when the face lacks it.

    Scryfall puts ``printed_name`` / ``flavor_name`` / ``illustration_id`` on the
    face for DFCs but on the card for single-image layouts; some faces of some
    layouts (e.g. ``meld`` results) omit them entirely.
    """
    value = face.get(field)
    return value if value is not None else card.get(field)


def face_metadata(card: dict, face_label: str) -> dict:
    """Derive every text-metadata column for one face of a Scryfall card.

    Args:
        card: A Scryfall card object (bulk-data or API shape).
        face_label: ``"single"`` for a card whose faces share one image (the
            card-level ``name`` is the row's name, and each ``card_faces[].name``
            becomes an extra key), or ``"front"`` / ``"back"`` for
            ``card_faces[0]`` / ``[1]`` of a double-faced card.

    Returns:
        A dict with exactly the keys ``layout, lang, printed_name, flavor_name,
        name_key, face_name_keys, collector_number_norm, collector_number_base,
        illustration_id, frame, border_color, full_art, textless, promo_types``.
        ``name_key`` is the normalised form of the name the row's ``name`` column
        holds today; ``face_name_keys`` is every key the face should answer to
        (full name, ``//`` halves, face names, Latin printed / flavor names); a
        non-empty ``name_key`` is always its first element.
    """
    if face_label not in FACE_LABELS:
        raise ValueError(f"unknown face label {face_label!r}; expected one of {FACE_LABELS}")

    faces: list[dict] = list(card.get("card_faces") or [])

    if face_label == "single":
        name = card.get("name") or ""
        printed_name = card.get("printed_name")
        flavor_name = card.get("flavor_name")
        illustration_id = card.get("illustration_id")
        # Split / adventure / flip: the halves are separate name boxes on the
        # one image, so each half is a key in its own right (also covered by
        # the "//" split in name_keys_for, but faces may carry their own
        # printed / flavor names too).
        face_names = [f.get("name") for f in faces if f.get("name")]
        extra_latin = [
            f.get(field)
            for f in faces
            for field in ("printed_name", "flavor_name")
            if f.get(field) and names.is_latin_name(f.get(field))
        ]
        # A single-image card without its own illustration_id (rare) borrows
        # the first face's, matching how Scryfall renders it.
        if illustration_id is None:
            illustration_id = next((f.get("illustration_id") for f in faces), None)
    else:
        index = 0 if face_label == "front" else 1
        face = faces[index] if index < len(faces) else {}
        name = face.get("name") or card.get("name") or ""
        printed_name = _face_field(face, card, "printed_name")
        flavor_name = _face_field(face, card, "flavor_name")
        illustration_id = _face_field(face, card, "illustration_id")
        face_names = []
        extra_latin = []

    keys = names.name_keys_for(
        name, face_names=face_names, printed_name=printed_name, flavor_name=flavor_name
    )
    for extra in extra_latin:
        key = names.normalize_key(extra)
        if key and key not in keys:
            keys.append(key)

    cn_norm, cn_base = names.normalize_collector_number(card.get("collector_number"))

    return {
        "layout": card.get("layout"),
        "lang": card.get("lang"),
        "printed_name": printed_name,
        "flavor_name": flavor_name,
        "name_key": names.normalize_key(name),
        "face_name_keys": keys,
        "collector_number_norm": cn_norm,
        "collector_number_base": cn_base,
        "illustration_id": illustration_id,
        "frame": card.get("frame"),
        "border_color": card.get("border_color"),
        "full_art": bool(card.get("full_art", False)),
        "textless": bool(card.get("textless", False)),
        "promo_types": list(card.get("promo_types") or []),
    }

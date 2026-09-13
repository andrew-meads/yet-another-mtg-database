"""
Ground-truth manifest for real-photo evaluation (``test-images.json``).

The user's ``card-scanner/test-images/test-images.json`` is the **source of
truth** for what each test photo contains. It is hand-authored and looks like::

    [
      {
        "fileName": "01-rise-ran-aang.jpg",
        "description": "3 cards on a white background ...",
        "cards": [
          {"name": "The Rise of Sozin", "set": "TLA", "number": "0117"},
          ...
        ]
      },
      ...
    ]

Tooling (``app.label_photos``, ``app.evaluate_photos``) extends entries
**additively** with machine-assisted fields and never rewrites a human-written
value. Because the file is loaded into plain dicts, mutated in place and dumped
back with ``json.dump(indent=2)``, unknown keys and key order survive a
round-trip.

A *dataset directory* is any directory holding a ``test-images.json`` (the real
photos, a synthetic-composite output directory, a folder of pre-cropped cards).

Photo entry keys
----------------
``fileName`` (required), ``description``, ``cards`` (required list), plus the
optional ``kind`` (``photo`` default | ``crop`` = the file already *is* a
de-skewed card, detection is skipped), ``background`` (free-form but from the
controlled vocabulary below where possible; missing → ``unknown``), ``tags``
(list of strings) and ``lighting``.

Background vocabulary: ``white-paper``, ``wood-light``, ``wood-dark``,
``playmat-art``, ``cloth-dark``, ``fabric-pattern``, ``glossy``,
``binder-page``, ``synth:<kind>``. Other strings are accepted (a validation
*note*, not an error) so new surfaces can be labelled before the list grows.

Card entry keys
---------------
Human: ``name`` (as printed, in the card's language), ``set`` (Scryfall set
code, any case), ``number`` (collector number as printed, e.g. ``0117``),
``finish``, ``extra``, ``name-en`` (English name of a foreign printing),
``flavorName`` (the printed flavor name, e.g. Azula for Diaochan), ``lang``
(physical card language, default ``en``), ``sleeved``, ``occluded``,
``anyPrintingOk`` (identity only matters at oracle level → ``set`` optional).

Machine-assisted: ``quad`` (4 ``[x, y]`` points in **printed order** TL, TR,
BR, BL — index 0 is the card's printed top-left — in full-resolution pixel
coordinates of the EXIF-corrected frame, i.e. what ``detection.load_image_bgr``
returns), ``quadSource`` (``draft`` | ``verified``), ``layout``,
``collectorLine`` (verbatim bottom-left text, for OCR metrics), ``scryfallId``
(a cached resolution).

Resolution rules (:func:`resolve_expected`)
-------------------------------------------
Manifest cards are matched to index rows offline-first, by the human fields:

1. ``set`` compares case-insensitively; ``number`` has leading zeros stripped
   and compares case-insensitively (``0117`` ↔ ``117``).
2. Exact ``(set, number)`` hit.
3. Same-set *base-number family*: strip trailing non-digits, so ``223`` matches
   ``223★`` / ``223s`` / ``223p`` (promo / prerelease twins that share the
   printed number). Warned.
4. No number (or no hit): ``set`` + name, where any of ``name``, ``name-en``,
   ``flavorName`` matches an index ``name`` with ``rapidfuzz.fuzz.ratio >= 90``
   (case-insensitive, so "Swift Saviour" resolves to "Aang, Swift Savior").
   Warned.
5. The cached ``scryfallId`` if present in the index. Warned.
6. Otherwise unresolved.

Every non-exact resolution carries a human-readable warning so the harness can
surface "the label is fuzzy" separately from "the scanner is wrong".
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NamedTuple

import numpy as np
from rapidfuzz import fuzz

from . import geometry

MANIFEST_NAME = "test-images.json"

KINDS = ("photo", "crop")
QUAD_SOURCES = ("draft", "verified")
BACKGROUNDS = (
    "white-paper",
    "wood-light",
    "wood-dark",
    "playmat-art",
    "cloth-dark",
    "fabric-pattern",
    "glossy",
    "binder-page",
)
ORIENTATIONS = ("upright", "rot180", "cw90", "ccw90")

# A two-number JSON array as ``indent=2`` prints it (used to re-compact quads).
_PAIR_RE = re.compile(r"\[\n\s+(-?\d+(?:\.\d+)?),\n\s+(-?\d+(?:\.\d+)?)\n\s+\]")

# Minimum rapidfuzz ratio for a name to count as the same card (rule 4 above).
NAME_MATCH_SCORE = 90.0


# --------------------------------------------------------------------------
# Manifest I/O
# --------------------------------------------------------------------------


def manifest_path(dir_or_file: str | Path) -> Path:
    """Resolve a dataset directory *or* a manifest file path to the manifest file."""
    p = Path(dir_or_file)
    return p / MANIFEST_NAME if p.is_dir() else p


def dataset_dir(dir_or_file: str | Path) -> Path:
    """The directory that a manifest's ``fileName`` values are relative to."""
    return manifest_path(dir_or_file).parent


def load_manifest(dir_or_file: str | Path) -> list[dict]:
    """Load a manifest as a list of plain dicts (key order preserved).

    Raises:
        FileNotFoundError: if the manifest does not exist.
        ValueError: if the JSON is malformed or not a list.
    """
    path = manifest_path(dir_or_file)
    with open(path, encoding="utf-8") as fh:
        try:
            data = json.load(fh)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise ValueError(f"{path}: top level must be a JSON array of photo entries")
    return data


def save_manifest(entries: list[dict], dir_or_file: str | Path) -> Path:
    """Write ``entries`` back as pretty JSON (2-space indent, UTF-8, trailing newline).

    ``ensure_ascii=False`` keeps names like "Wurzelmauer" or "★" readable in the
    diff instead of turning them into ``\\uXXXX`` escapes.
    """
    path = manifest_path(dir_or_file)
    text = json.dumps(entries, indent=2, ensure_ascii=False)
    # ``indent=2`` puts every coordinate on its own line, turning one quad into
    # 18 lines. Collapse ``[x, y]`` number pairs back onto one line so a quad
    # reads as four short rows in a diff. Still plain JSON; nothing else moves.
    text = _PAIR_RE.sub(lambda m: f"[{m.group(1)}, {m.group(2)}]", text)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")
    return path


def entry_prefix(entry: dict) -> str | None:
    """The ``NN`` numeric prefix of an entry's ``fileName`` (``"01-foo.jpg"`` → ``"01"``)."""
    m = re.match(r"^(\d+)-", str(entry.get("fileName", "")))
    return m.group(1) if m else None


def entry_kind(entry: dict) -> str:
    """``kind`` with its default applied."""
    return str(entry.get("kind") or "photo")


def entry_background(entry: dict) -> str:
    """``background`` with its default applied."""
    return str(entry.get("background") or "unknown")


def card_quad(card: dict) -> np.ndarray | None:
    """The card's ``quad`` as a float32 ``(4, 2)`` array, or ``None`` if absent."""
    quad = card.get("quad")
    if quad is None:
        return None
    return np.asarray(quad, dtype=np.float32).reshape(4, 2)


def is_verified(card: dict) -> bool:
    """Whether a card carries a human-checked quad."""
    return card.get("quad") is not None and card.get("quadSource") == "verified"


# --------------------------------------------------------------------------
# Validation (offline, structure only)
# --------------------------------------------------------------------------


def image_frame_size(path: Path) -> tuple[int, int] | None:
    """``(width, height)`` of an image **after EXIF orientation**, without decoding pixels.

    Quads are recorded in the frame that ``detection.load_image_bgr`` produces,
    which bakes the EXIF orientation tag into the pixels. Phone photos taken in
    portrait are typically stored landscape with orientation 6/8, so the
    header size must be swapped for tags 5–8 or every portrait quad would look
    out of frame. Returns ``None`` for unreadable files.
    """
    try:
        from PIL import Image

        with Image.open(path) as im:
            w, h = im.size
            orientation = im.getexif().get(0x0112, 1)
    except Exception:
        return None
    # Tags 5-8 involve a 90° rotation (possibly plus a mirror) → swap axes.
    return (h, w) if orientation in (5, 6, 7, 8) else (w, h)


def _is_convex_quad(quad: np.ndarray) -> bool:
    """Strictly convex, non-degenerate, consistently wound 4-gon."""
    q = quad.astype(np.float64)
    cross = []
    for k in range(4):
        a = q[(k + 1) % 4] - q[k]
        b = q[(k + 2) % 4] - q[(k + 1) % 4]
        cross.append(a[0] * b[1] - a[1] * b[0])
    signs = np.sign(cross)
    return bool(np.all(signs > 0) or np.all(signs < 0))


def _validate_card(where: str, card: Any, size: tuple[int, int] | None) -> list[str]:
    problems: list[str] = []
    if not isinstance(card, dict):
        return [f"{where}: card must be an object"]
    if not isinstance(card.get("name"), str) or not card["name"].strip():
        problems.append(f"{where}: 'name' is required")
    if "set" in card and (not isinstance(card["set"], str) or not card["set"].strip()):
        problems.append(f"{where}: 'set' must be a non-empty string")
    if "set" not in card and not card.get("anyPrintingOk"):
        problems.append(f"{where}: 'set' is required unless anyPrintingOk is true")
    for key in ("number", "finish", "extra", "name-en", "flavorName", "lang", "layout"):
        if key in card and not isinstance(card[key], str):
            problems.append(f"{where}: '{key}' must be a string")
    if "collectorLine" in card and not isinstance(card["collectorLine"], str):
        problems.append(f"{where}: 'collectorLine' must be a string")
    for key in ("sleeved", "occluded", "anyPrintingOk"):
        if key in card and not isinstance(card[key], bool):
            problems.append(f"{where}: '{key}' must be true/false")
    if "scryfallId" in card and not isinstance(card["scryfallId"], str):
        problems.append(f"{where}: 'scryfallId' must be a string")

    has_quad = "quad" in card
    has_source = "quadSource" in card
    if has_source and card["quadSource"] not in QUAD_SOURCES:
        problems.append(f"{where}: 'quadSource' must be one of {QUAD_SOURCES}")
    if has_quad != has_source:
        problems.append(f"{where}: 'quad' and 'quadSource' must be present together")
    if has_quad:
        quad = card["quad"]
        ok_shape = (
            isinstance(quad, list)
            and len(quad) == 4
            and all(
                isinstance(p, list)
                and len(p) == 2
                and all(isinstance(v, int | float) and not isinstance(v, bool) for v in p)
                for p in quad
            )
        )
        if not ok_shape:
            problems.append(f"{where}: 'quad' must be 4 [x, y] number pairs")
        else:
            q = np.asarray(quad, dtype=np.float64)
            if not _is_convex_quad(q):
                problems.append(f"{where}: 'quad' is not a convex quadrilateral")
            if size is not None:
                w, h = size
                if (
                    (q[:, 0] < 0).any()
                    or (q[:, 1] < 0).any()
                    or (q[:, 0] > w).any()
                    or (q[:, 1] > h).any()
                ):
                    problems.append(f"{where}: 'quad' has a corner outside the {w}x{h} frame")
    return problems


def validate_manifest(entries: list[dict], root: str | Path) -> list[str]:
    """Structural, offline validation. Returns a list of human-readable problems.

    Checks: each entry is an object with a string ``fileName`` that exists under
    ``root``, a ``cards`` list, valid ``kind`` / ``quadSource`` values, sane
    types, ``set`` present unless ``anyPrintingOk``, and every ``quad`` convex
    and inside the image frame. ``kind: crop`` entries must list exactly one
    card and carry no quads (the whole file is the card).

    Args:
        entries: The loaded manifest.
        root: Dataset directory the file names are relative to.

    Returns:
        ``[]`` when the manifest is valid.
    """
    root = Path(root)
    problems: list[str] = []
    seen: set[str] = set()
    if not isinstance(entries, list):
        return ["manifest must be a JSON array"]

    for i, entry in enumerate(entries):
        where = f"entry[{i}]"
        if not isinstance(entry, dict):
            problems.append(f"{where}: must be an object")
            continue
        file_name = entry.get("fileName")
        if not isinstance(file_name, str) or not file_name:
            problems.append(f"{where}: 'fileName' is required")
            file_name = None
        else:
            where = file_name
            if file_name in seen:
                problems.append(f"{where}: duplicate fileName")
            seen.add(file_name)
        path = root / file_name if file_name else None
        size = None
        if path is not None:
            if not path.is_file():
                problems.append(f"{where}: file not found under {root}")
            else:
                size = image_frame_size(path)
                if size is None:
                    problems.append(f"{where}: not a readable image")

        if "description" in entry and not isinstance(entry["description"], str):
            problems.append(f"{where}: 'description' must be a string")
        kind = entry.get("kind", "photo")
        if kind not in KINDS:
            problems.append(f"{where}: 'kind' must be one of {KINDS}")
        if "background" in entry and not isinstance(entry["background"], str):
            problems.append(f"{where}: 'background' must be a string")
        if "lighting" in entry and not isinstance(entry["lighting"], str):
            problems.append(f"{where}: 'lighting' must be a string")
        tags = entry.get("tags")
        if tags is not None and (
            not isinstance(tags, list) or not all(isinstance(t, str) for t in tags)
        ):
            problems.append(f"{where}: 'tags' must be a list of strings")

        cards = entry.get("cards")
        if not isinstance(cards, list):
            problems.append(f"{where}: 'cards' must be a list")
            continue
        if kind == "crop":
            if len(cards) != 1:
                problems.append(f"{where}: a 'crop' entry must list exactly one card")
            if any(isinstance(c, dict) and "quad" in c for c in cards):
                problems.append(f"{where}: a 'crop' entry must not carry quads")
        for j, card in enumerate(cards):
            problems.extend(_validate_card(f"{where} cards[{j}]", card, size))
    return problems


# --------------------------------------------------------------------------
# Index maps + resolution
# --------------------------------------------------------------------------


def normalize_set(code: str | None) -> str:
    """Lower-cased, stripped set code (``""`` for None)."""
    return (code or "").strip().lower()


def normalize_number(number: str | None) -> str:
    """Collector number normalised for comparison: lower-case, leading zeros stripped.

    ``"0117"`` → ``"117"``, ``"57A"`` → ``"57a"``, ``"A-219"`` → ``"a-219"``,
    ``"0"`` → ``"0"`` (a lone zero is kept).
    """
    s = (number or "").strip().lower()
    return re.sub(r"^0+(?=\d)", "", s)


def base_number(number: str | None) -> str:
    """The numeric family of a collector number: normalised, trailing non-digits removed.

    ``"223★"`` / ``"223s"`` / ``"223p"`` → ``"223"``. Numbers with no trailing
    digit run (``"★"``) fall back to their normalised form so they only match
    themselves.
    """
    norm = normalize_number(number)
    base = re.sub(r"\D+$", "", norm)
    return base or norm


def normalize_name(name: str | None) -> str:
    """Case-folded, whitespace-collapsed name for fuzzy comparison."""
    return re.sub(r"\s+", " ", (name or "").strip()).casefold()


class IndexRow(NamedTuple):
    """The metadata columns of one index row (one card *face*)."""

    row_id: int
    scryfall_id: str
    oracle_id: str | None
    name: str
    set_code: str
    collector_number: str
    face: str | None


@dataclass
class IndexMaps:
    """Lookup tables over the index's metadata columns (no image blobs).

    Built once per run from ``SELECT id, scryfall_id, oracle_id, name,
    set_code, collector_number, face FROM cards`` (:meth:`load`) or from
    plain dicts in tests (:meth:`from_rows`). Keys are normalised with
    :func:`normalize_set` / :func:`normalize_number` / :func:`base_number` /
    :func:`normalize_name` so lookups never worry about case or leading zeros.

    Note: the ``cards`` table has no ``flavor_name`` column today, so flavor
    names are matched against ``name`` only (the manifest's ``flavorName`` is
    still tried as a query string, which helps once the metadata backfill adds
    the column).
    """

    rows: list[IndexRow] = field(default_factory=list)
    by_scryfall_id: dict[str, list[IndexRow]] = field(default_factory=dict)
    by_set_number: dict[tuple[str, str], list[IndexRow]] = field(default_factory=dict)
    by_set_base: dict[tuple[str, str], list[IndexRow]] = field(default_factory=dict)
    # set -> normalised name -> rows; used for the fuzzy name fallback.
    names_by_set: dict[str, dict[str, list[IndexRow]]] = field(default_factory=dict)
    # normalised name -> rows across every set (anyPrintingOk without a set).
    by_name: dict[str, list[IndexRow]] = field(default_factory=dict)

    @classmethod
    def from_rows(cls, rows: Iterable[dict | IndexRow]) -> IndexMaps:
        """Build the maps from dict rows (``id``/``row_id`` … ) or :class:`IndexRow` tuples."""
        maps = cls()
        by_sid: dict[str, list[IndexRow]] = defaultdict(list)
        by_sn: dict[tuple[str, str], list[IndexRow]] = defaultdict(list)
        by_sb: dict[tuple[str, str], list[IndexRow]] = defaultdict(list)
        names_by_set: dict[str, dict[str, list[IndexRow]]] = defaultdict(lambda: defaultdict(list))
        by_name: dict[str, list[IndexRow]] = defaultdict(list)
        for raw in rows:
            row = (
                raw
                if isinstance(raw, IndexRow)
                else IndexRow(
                    row_id=int(raw.get("row_id", raw.get("id"))),
                    scryfall_id=str(raw["scryfall_id"]),
                    oracle_id=raw.get("oracle_id"),
                    name=str(raw.get("name") or ""),
                    set_code=str(raw.get("set_code") or ""),
                    collector_number=str(raw.get("collector_number") or ""),
                    face=raw.get("face"),
                )
            )
            maps.rows.append(row)
            s = normalize_set(row.set_code)
            by_sid[row.scryfall_id].append(row)
            by_sn[(s, normalize_number(row.collector_number))].append(row)
            by_sb[(s, base_number(row.collector_number))].append(row)
            n = normalize_name(row.name)
            names_by_set[s][n].append(row)
            by_name[n].append(row)
        maps.by_scryfall_id = dict(by_sid)
        maps.by_set_number = dict(by_sn)
        maps.by_set_base = dict(by_sb)
        maps.names_by_set = {s: dict(d) for s, d in names_by_set.items()}
        maps.by_name = dict(by_name)
        return maps

    @classmethod
    def load(cls, conn=None) -> IndexMaps:
        """Load the maps from Postgres (one metadata-only query, ~1 s for 115k rows)."""
        from . import index_db

        sql = "SELECT id, scryfall_id, oracle_id, name, set_code, collector_number, face FROM cards"
        if conn is not None:
            return cls.from_rows(conn.execute(sql))
        with index_db.connection() as c:
            return cls.from_rows(c.execute(sql).fetchall())

    @property
    def size(self) -> int:
        """Number of index rows (card faces)."""
        return len(self.rows)

    def oracle_of(self, scryfall_id: str | None) -> str | None:
        """Oracle id for a Scryfall id (any face), or None if not indexed."""
        rows = self.by_scryfall_id.get(scryfall_id or "")
        return rows[0].oracle_id if rows else None


@dataclass
class Resolution:
    """Outcome of :func:`resolve_expected` for one manifest card.

    ``how`` is one of ``exact``, ``family``, ``name``, ``name-any-set``,
    ``scryfall-id`` or ``unresolved``; ``warning`` is set for anything but
    ``exact``. ``row`` is the chosen index row (``None`` when unresolved) and
    the remaining fields mirror it for convenient reporting.
    """

    row_id: int | None
    scryfall_id: str | None
    oracle_id: str | None
    how: str
    warning: str | None = None
    row: IndexRow | None = None

    @property
    def resolved(self) -> bool:
        return self.row is not None

    @property
    def set_code(self) -> str | None:
        return self.row.set_code if self.row else None

    @property
    def collector_number(self) -> str | None:
        return self.row.collector_number if self.row else None

    @property
    def name(self) -> str | None:
        return self.row.name if self.row else None


def _card_query_names(card: dict) -> list[str]:
    """The manifest strings that may equal the index ``name``, most specific first."""
    names = [card.get("name"), card.get("name-en"), card.get("flavorName")]
    return [n for n in names if isinstance(n, str) and n.strip()]


def _pick_face(rows: list[IndexRow], card: dict) -> IndexRow:
    """Among rows sharing a Scryfall id (DFC faces), prefer the face whose name matches."""
    if len(rows) == 1:
        return rows[0]
    queries = [normalize_name(n) for n in _card_query_names(card)]
    best, best_score = rows[0], -1.0
    for row in rows:
        score = max((fuzz.ratio(q, normalize_name(row.name)) for q in queries), default=0.0)
        if score > best_score:
            best, best_score = row, score
    # A non-front face only wins when a query name actually names it.
    return best if best_score >= NAME_MATCH_SCORE else rows[0]


def _group_by_printing(rows: list[IndexRow]) -> dict[str, list[IndexRow]]:
    """Group face rows by Scryfall id, preserving first-seen order."""
    groups: dict[str, list[IndexRow]] = {}
    for row in rows:
        groups.setdefault(row.scryfall_id, []).append(row)
    return groups


def _describe(rows: list[IndexRow]) -> str:
    """Compact ``set:number`` list of the distinct printings in ``rows``."""
    seen: list[str] = []
    for r in rows:
        tag = f"{r.set_code}:{r.collector_number}"
        if tag not in seen:
            seen.append(tag)
    return ", ".join(seen)


def _choose_printing(rows: list[IndexRow], card: dict) -> tuple[IndexRow, list[IndexRow], bool]:
    """Pick one printing out of candidate rows; returns ``(row, all_rows, ambiguous)``.

    A cached ``scryfallId`` wins when it is among the candidates; otherwise the
    printing whose collector number sorts first (``"223"`` before ``"223s"``),
    so the plain printing beats its promo twins. ``ambiguous`` is True when
    more than one printing was possible.
    """
    groups = _group_by_printing(rows)
    cached = card.get("scryfallId")
    if isinstance(cached, str) and cached in groups:
        chosen = groups[cached]
    else:
        chosen = min(
            groups.values(),
            key=lambda g: (len(normalize_number(g[0].collector_number)), g[0].collector_number),
        )
    return _pick_face(chosen, card), rows, len(groups) > 1


def _resolve_by_name(
    card: dict, names: dict[str, list[IndexRow]]
) -> tuple[IndexRow | None, float, str | None, list[IndexRow]]:
    """Best fuzzy name hit in ``names``: ``(row, score, matched_query, candidate_rows)``."""
    best_rows: list[IndexRow] = []
    best_score, best_query = 0.0, None
    for query in _card_query_names(card):
        q = normalize_name(query)
        for key, rows in names.items():
            score = fuzz.ratio(q, key)
            if score > best_score:
                best_rows, best_score, best_query = rows, float(score), query
    if best_score < NAME_MATCH_SCORE or not best_rows:
        return None, best_score, None, []
    return best_rows[0], best_score, best_query, best_rows


def resolve_expected(card: dict, index_maps: IndexMaps) -> Resolution:
    """Map a manifest card to an index row using the rules in the module docstring.

    Args:
        card: A manifest card entry (dict).
        index_maps: Lookup tables built from the live index.

    Returns:
        A :class:`Resolution`; check ``.resolved`` / ``.how`` / ``.warning``.
    """
    set_code = normalize_set(card.get("set"))
    number = card.get("number")
    label = f"{card.get('name')!r} {card.get('set') or '?'}:{number or '?'}"

    def done(row: IndexRow, how: str, warning: str | None) -> Resolution:
        return Resolution(row.row_id, row.scryfall_id, row.oracle_id, how, warning, row)

    if set_code and number:
        # Rule 2: exact set + number (leading zeros / case ignored).
        rows = index_maps.by_set_number.get((set_code, normalize_number(number)))
        if rows:
            return done(_pick_face(rows, card), "exact", None)
        # Rule 3: same-set base-number family (promo / prerelease twins).
        rows = index_maps.by_set_base.get((set_code, base_number(number)))
        if rows:
            row, all_rows, ambiguous = _choose_printing(rows, card)
            warn = (
                f"{label}: number not indexed; resolved via base-number family to "
                f"{row.set_code}:{row.collector_number}"
            )
            if ambiguous:
                warn += f" (candidates: {_describe(all_rows)})"
            return done(row, "family", warn)

    if set_code:
        # Rule 4: set + fuzzy name (no number, or number not found).
        row, score, query, rows = _resolve_by_name(card, index_maps.names_by_set.get(set_code, {}))
        if row is not None:
            row, all_rows, ambiguous = _choose_printing(rows, card)
            why = "no number given" if not number else f"number {number!r} not indexed"
            warn = (
                f"{label}: {why}; resolved by name {query!r} ~ {row.name!r} "
                f"(score {score:.0f}) to {row.set_code}:{row.collector_number}"
            )
            if ambiguous:
                warn += f" (ambiguous printings: {_describe(all_rows)})"
            return done(row, "name", warn)
    elif card.get("anyPrintingOk"):
        # Rule 4b: no set at all is fine when any printing is acceptable.
        row, score, query, rows = _resolve_by_name(card, index_maps.by_name)
        if row is not None:
            row, all_rows, _ambiguous = _choose_printing(rows, card)
            warn = (
                f"{label}: no set; resolved by name {query!r} ~ {row.name!r} "
                f"(score {score:.0f}) to {row.set_code}:{row.collector_number} (anyPrintingOk)"
            )
            return done(row, "name-any-set", warn)

    # Rule 5: a cached Scryfall id.
    cached = card.get("scryfallId")
    if isinstance(cached, str) and cached in index_maps.by_scryfall_id:
        row = _pick_face(index_maps.by_scryfall_id[cached], card)
        return done(row, "scryfall-id", f"{label}: resolved only via cached scryfallId {cached}")

    return Resolution(None, None, None, "unresolved", f"{label}: not found in the index")


# --------------------------------------------------------------------------
# Orientation helpers
# --------------------------------------------------------------------------


def orientation_of(quad: np.ndarray) -> str:
    """Classify how a card lies in the photo from its **printed-order** quad.

    Uses the printed TL→TR vector. In image coordinates (y down) its angle is
    ≈ 0° when the card is upright, ≈ ±180° when it is upside down, ≈ +90° when
    the vector points *down* the image (the card was photographed rotated
    clockwise, so its printed top edge is on the right) → ``cw90``, and ≈ −90°
    → ``ccw90``. Buckets are 90° wide, so a 40° tilt still reads as upright.

    Returns:
        One of ``upright``, ``rot180``, ``cw90``, ``ccw90``.
    """
    q = geometry._as_quad(quad)
    v = q[1] - q[0]
    angle = float(np.degrees(np.arctan2(v[1], v[0])))  # (-180, 180]
    if -45.0 <= angle < 45.0:
        return "upright"
    if 45.0 <= angle < 135.0:
        return "cw90"
    if -135.0 <= angle < -45.0:
        return "ccw90"
    return "rot180"


def printed_order_from_detection(
    quad_geometric: np.ndarray, landscape: bool, flipped: bool
) -> np.ndarray:
    """Cyclically shift a geometric quad so index 0 is the card's *printed* top-left.

    The detector orders corners geometrically (:func:`geometry.order_points`)
    and warps them so geometric TL lands at the crop's top-left. Two later
    steps move the printed top-left away from index 0:

    * ``landscape`` — the warp came out wider than tall and
      ``detection._normalize_to_card`` rotated it 90° **clockwise**. Under
      ``cv2.ROTATE_90_CLOCKWISE`` the old bottom-left pixel becomes the new
      top-left, so the crop's TL, TR, BR, BL are the geometric BL, TL, TR, BR:
      shift by one (``np.roll(quad, 1)``).
    * ``flipped`` — the crop is upside down (its 180° pHash variant matched
      better, or a human said so), so the printed TL is at the crop's
      bottom-right: shift by two more.

    Args:
        quad_geometric: ``order_points`` output (TL, TR, BR, BL as seen in the image).
        landscape: Whether ``warp_size(quad)`` gives ``width > height``.
        flipped: Whether the (portrait) crop is upside down.

    Returns:
        The same four points, rolled so ``[0]`` is the printed top-left,
        still clockwise (printed TL, TR, BR, BL).
    """
    q = geometry._as_quad(quad_geometric)
    if landscape:
        q = np.roll(q, 1, axis=0)
    if flipped:
        q = np.roll(q, 2, axis=0)
    return q.astype(np.float32)


def quad_to_json(quad: np.ndarray) -> list[list[int]]:
    """Round a quad to integer pixel pairs for the manifest."""
    return [[int(round(float(x))), int(round(float(y)))] for x, y in geometry._as_quad(quad)]

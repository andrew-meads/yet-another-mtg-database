"""
Name and collector-line matching — the text side of identification.

OCR (see ``app.ocr``) turns a card crop into a handful of ``(text, confidence)``
lines. This module turns those lines into *index rows* without touching the
database, the network or OCR itself, so it is pure and cheap to test:

* :func:`normalize_key` folds a card name into the canonical lower-case ASCII
  form that both the index (``cards.name_key`` / ``face_name_keys``) and the
  OCR lines are compared in. Everything that OCR is bad at (accents, ligatures,
  apostrophes, punctuation, case) is folded away on *both* sides so a plain
  edit-distance ratio measures only real misreads.
* :class:`NameTable` is the in-memory lookup structure built once per index
  load: the sorted unique key list that ``rapidfuzz`` compares against, plus
  reverse maps from key / ``(set, number)`` to index row positions.
* :func:`match_names` is the fuzzy name pass (plan item B4). One vectorised
  ``process.cdist`` call scores every line against every key; guards keep short
  names ("Fog", "Opt") from matching rules text, and a second ``partial_ratio``
  pass rescues name boxes that swallowed the mana cost or a type line.
* :func:`parse_collector_line` reads the bottom-left collector line (plan item
  B3): number, rarity, total, set code and language, combining fragments that
  OCR split across lines and repairing the usual glyph confusions in set codes.
* :func:`lookup_collector` turns a collector hit into index rows through a
  ladder of increasingly loose lookups.

All tunables are keyword parameters with defaults; the matcher passes the
``config.*`` values so this module never imports ``config``.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field

import numpy as np
from rapidfuzz import fuzz, process

# --- Name normalisation -------------------------------------------------------

# Characters NFKD cannot decompose into an ASCII base letter + combining mark.
# These are the ones that actually occur in Magic card names (Æther Vial,
# Lim-Dûl is handled by NFKD, ß only in printed names) plus their case pairs.
_LIGATURES = str.maketrans(
    {
        "Æ": "ae",
        "æ": "ae",
        "Œ": "oe",
        "œ": "oe",
        "ß": "ss",
        "Ø": "o",
        "ø": "o",
        "Ð": "d",
        "ð": "d",
        "Þ": "th",
        "þ": "th",
        "Ł": "l",
        "ł": "l",
    }
)

# Typographic quotes → straight quotes, so the apostrophe rule below catches
# both "Freyalise’s" (curly, Scryfall) and "Freyalise's" (straight, OCR).
_QUOTES = str.maketrans({"’": "'", "‘": "'", "‚": "'", "‛": "'", "“": '"', "”": '"', "„": '"'})

_NON_ALNUM_RUN = re.compile(r"[^a-z0-9]+")


def _fold(s: str) -> str:
    """Accent/ligature/quote/apostrophe/case folding — everything except the
    punctuation-to-space step of :func:`normalize_key`.

    Split out because :func:`is_latin_name` wants to count letters *before*
    punctuation and non-Latin characters are collapsed into spaces.
    """
    s = s.translate(_LIGATURES).translate(_QUOTES)
    # NFKD splits "û" into "u" + a combining circumflex; dropping every
    # combining mark then leaves the base letter.
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    # OCR almost never reads the apostrophe in "Freyalise's", so delete it on
    # both sides rather than letting it cost one edit per possessive.
    s = s.replace("'", "")
    return s.lower()


def normalize_key(s: str) -> str:
    """Fold a card name (or OCR line) into its canonical comparison key.

    ``"Æther Vial"`` → ``"aether vial"``, ``"Lim-Dûl's Vault"`` → ``"lim dul vault"``
    (hyphen and other punctuation become single spaces, the apostrophe is
    deleted), ``"Armed // Dangerous"`` → ``"armed dangerous"``. Whitespace-only
    input gives ``""``.
    """
    if not s:
        return ""
    folded = _fold(s)
    return _NON_ALNUM_RUN.sub(" ", folded).strip()


def is_latin_name(s: str | None) -> bool:
    """True when a name is worth indexing for Latin-script OCR.

    At least 60 % of the non-space characters (after accent folding, before
    punctuation is dropped) must be ASCII letters. A Japanese ``printed_name``
    such as ``対抗呪文`` folds to no letters at all and is rejected; a name with
    a few digits or symbols (``"B.F.M. (Big Furry Monster)"``) passes. Counting
    on the folded-but-unpunctuated string (rather than the final key) means a
    mostly-CJK name with a stray Latin word is still rejected instead of
    being reduced to that word.
    """
    if not s:
        return False
    chars = [c for c in _fold(s) if not c.isspace()]
    if not chars:
        return False
    latin = sum(1 for c in chars if "a" <= c <= "z")
    return latin / len(chars) >= 0.6


def name_keys_for(
    name: str,
    *,
    face_names: Iterable[str] = (),
    printed_name: str | None = None,
    flavor_name: str | None = None,
) -> list[str]:
    """Every comparison key a card face should answer to, full name first.

    Includes the full name, each half of an ``"A // B"`` name (a split card's
    halves are printed as two separate name boxes), each explicit face name,
    and the printed / flavor names when they are Latin script (the physical
    card of ``Diaochan, Artful Beauty`` may read ``Azula, Flame of Ember
    Island``). Keys are de-duplicated preserving first occurrence and empty
    keys are dropped.
    """
    candidates: list[str] = [name]
    candidates.extend(face_names)
    for extra in (printed_name, flavor_name):
        if extra and is_latin_name(extra):
            candidates.append(extra)

    keys: list[str] = []
    seen: set[str] = set()
    for raw in candidates:
        if not raw:
            continue
        # The full name is kept as one key *and* split into halves, because a
        # name box on the card shows one half while the index stores "A // B".
        parts = [raw]
        if "//" in raw:
            parts.extend(p for p in raw.split("//"))
        for part in parts:
            key = normalize_key(part)
            if key and key not in seen:
                seen.add(key)
                keys.append(key)
    return keys


# --- Collector-number normalisation ------------------------------------------

_LEADING_ZEROS = re.compile(r"^0+(?=\d)")
_TRAILING_LETTERS = re.compile(r"[a-z]+$")


def normalize_collector_number(cn: str | None) -> tuple[str, str]:
    """Return ``(norm, base)`` for a Scryfall or OCR'd collector number.

    ``norm`` strips whitespace, the ``★``/``†`` decorations Scryfall appends to
    some promo numbers, and leading zeros from the leading digit run (cards
    print ``0117``, Scryfall stores ``117``), then lower-cases. ``base`` drops
    trailing letters so the promo/prerelease/planeswalker-deck family
    (``224s``, ``224p``, ``57a``) collapses onto ``224`` / ``57``. Alphanumeric
    prefixes are kept (``A-219`` → ``a-219`` / ``a-219``).
    """
    if not cn:
        return "", ""
    s = re.sub(r"\s+", "", cn).replace("★", "").replace("†", "")
    s = _LEADING_ZEROS.sub("", s).lower()
    return s, _TRAILING_LETTERS.sub("", s)


# --- Name table ---------------------------------------------------------------


def _to_index_array(values: list[int]) -> np.ndarray:
    return np.asarray(sorted(values), dtype=np.int64)


@dataclass
class NameTable:
    """Reverse lookups from text to index row positions.

    Built once per index load by :meth:`from_rows` from the Stage-1 metadata
    arrays. ``row_index`` values are positions into the matcher's cached
    ``ids``/``hashes`` arrays (not database ids), so a hit maps straight onto
    the Hamming-distance array without a further lookup.

    Attributes:
        keys: Sorted unique normalised keys over every row's ``name_key`` and
            ``face_name_keys`` — the ``choices`` list for ``rapidfuzz``.
        key_lengths: ``len`` of each key, aligned with ``keys`` (the short-name
            guard is applied as a vectorised mask, so lengths are precomputed).
        rows_by_key: key → sorted row positions carrying that key.
        rows_by_set_cn: ``(set_code, cn_norm)`` → row positions.
        rows_by_set_base: ``(set_code, cn_base)`` → row positions.
        rows_by_cn: ``cn_norm`` → row positions (any set), for the set-less
            rungs of :func:`lookup_collector`.
        rows_by_cn_base: ``cn_base`` → row positions (any set).
        set_codes: Lower-case set codes present in the index, used to validate
            OCR'd set codes.
    """

    keys: list[str] = field(default_factory=list)
    key_lengths: np.ndarray = field(default_factory=lambda: np.empty(0, dtype=np.int64))
    rows_by_key: dict[str, np.ndarray] = field(default_factory=dict)
    rows_by_set_cn: dict[tuple[str, str], np.ndarray] = field(default_factory=dict)
    rows_by_set_base: dict[tuple[str, str], np.ndarray] = field(default_factory=dict)
    rows_by_cn: dict[str, np.ndarray] = field(default_factory=dict)
    rows_by_cn_base: dict[str, np.ndarray] = field(default_factory=dict)
    set_codes: frozenset[str] = frozenset()

    @classmethod
    def from_rows(
        cls,
        rows: Iterable[
            tuple[int, str | None, Iterable[str] | None, str | None, str | None, str | None]
        ],
    ) -> NameTable:
        """Build the table from ``(row_index, name_key, face_name_keys, set_code,
        cn_norm, cn_base)`` tuples.

        ``face_name_keys`` normally already contains ``name_key`` (that is how
        :func:`app.metadata.face_metadata` produces it) but the union is taken
        regardless. Empty keys / numbers never enter a map; set codes are
        lower-cased. Lists are accumulated first and converted to NumPy arrays at
        the end, which is far cheaper than growing arrays per row.
        """
        by_key: dict[str, list[int]] = {}
        by_set_cn: dict[tuple[str, str], list[int]] = {}
        by_set_base: dict[tuple[str, str], list[int]] = {}
        by_cn: dict[str, list[int]] = {}
        by_cn_base: dict[str, list[int]] = {}
        set_codes: set[str] = set()

        for row_index, name_key, face_keys, set_code, cn_norm, cn_base in rows:
            row_index = int(row_index)
            keys = {name_key} if name_key else set()
            if face_keys:
                keys.update(k for k in face_keys if k)
            for key in keys:
                by_key.setdefault(key, []).append(row_index)

            set_lc = set_code.lower() if set_code else None
            if set_lc:
                set_codes.add(set_lc)
            if cn_norm:
                by_cn.setdefault(cn_norm, []).append(row_index)
                if set_lc:
                    by_set_cn.setdefault((set_lc, cn_norm), []).append(row_index)
            if cn_base:
                by_cn_base.setdefault(cn_base, []).append(row_index)
                if set_lc:
                    by_set_base.setdefault((set_lc, cn_base), []).append(row_index)

        keys_sorted = sorted(by_key)
        return cls(
            keys=keys_sorted,
            key_lengths=np.fromiter(
                (len(k) for k in keys_sorted), dtype=np.int64, count=len(keys_sorted)
            ),
            rows_by_key={k: _to_index_array(v) for k, v in by_key.items()},
            rows_by_set_cn={k: _to_index_array(v) for k, v in by_set_cn.items()},
            rows_by_set_base={k: _to_index_array(v) for k, v in by_set_base.items()},
            rows_by_cn={k: _to_index_array(v) for k, v in by_cn.items()},
            rows_by_cn_base={k: _to_index_array(v) for k, v in by_cn_base.items()},
            set_codes=frozenset(set_codes),
        )


_EMPTY_ROWS = np.empty(0, dtype=np.int64)


# --- Fuzzy name matching ------------------------------------------------------


@dataclass(frozen=True)
class NameHit:
    """One matched name key.

    Attributes:
        key: The matched normalised key (present in ``NameTable.keys``).
        score: rapidfuzz similarity, 0–100.
        line_conf: OCR confidence (0–1) of the line that produced the score.
        line_text: The raw OCR text of that line, for debugging output.
        partial: True when the score came from the ``partial_ratio`` pass
            (the line contains the name plus extra characters).
    """

    key: str
    score: float
    line_conf: float
    line_text: str
    partial: bool = False


# The copyright / legal line at the bottom of every card ("™ & © 2023 Wizards of the
# Coast", localised variants, "Viacom", "Hasbro") is never a name, yet it is long
# enough for the partial pass to find a 10-12 character key inside it. Skip it.
_LEGAL_LINE = re.compile(
    r"wizards of the coast|all rights reserved|alle rechte|tous droits|todos los derechos|"
    r"tutti i diritti|\bviacom\b|\bhasbro\b|\(c\)\s*\d{4}|©|\btm\b\s*&",
    re.IGNORECASE,
)


def match_names(
    lines: list[tuple[str, float]],
    table: NameTable,
    *,
    min_score: float = 80,
    short_len: int = 5,
    mid_len: int = 7,
    mid_score: float = 90,
    top_m: int = 3,
    ambiguity_gap: float = 5,
    partial_min_len: int = 10,
    partial_min_score: float = 92,
    partial_min_coverage: float = 0.4,
) -> list[NameHit]:
    """Fuzzy-match OCR lines against every name key in the table.

    Args:
        lines: ``(text, confidence)`` per OCR line. Lines with a negative
            confidence or an empty normalised text are ignored.
        table: The loaded :class:`NameTable`.
        min_score: ``fuzz.ratio`` floor for any hit.
        short_len: Keys shorter than this ("fog", "opt") must match exactly
            (score 100 and line length within ±1) — a rules-text word one edit
            away from a three-letter name is far likelier than a misread name.
        mid_len / mid_score: Keys shorter than ``mid_len`` need at least
            ``mid_score`` (5–6 letter names still have few edits to spare).
        top_m: Number of distinct keys to keep.
        ambiguity_gap: Further keys whose ranking value is within this many
            points of the last kept key are also returned, so a near-tie always
            puts *both* contenders into the shortlist.
        partial_min_len / partial_min_score: The ``partial_ratio`` pass only
            considers keys at least ``partial_min_len`` long and lines longer
            than the key (the name box swallowed the mana cost or a type line);
            it needs ``partial_min_score`` because substring matching is far
            more permissive than the full ratio. ``partial_min_coverage`` is the
            minimum key length as a fraction of the line length: a match must
            explain most of the line, not hide inside a long one.

    Returns:
        Hits ranked by ``score × line_conf`` descending, one per key (the best
        line for that key), at most ``top_m`` plus the near-ties.
    """
    n_keys = len(table.keys)
    if n_keys == 0:
        return []

    norm_lines: list[str] = []
    raw_lines: list[str] = []
    confs: list[float] = []
    for text, conf in lines:
        if conf is None or conf < 0:
            continue
        if _LEGAL_LINE.search(text or ""):
            continue
        norm = normalize_key(text or "")
        if not norm:
            continue
        norm_lines.append(norm)
        raw_lines.append(text)
        confs.append(float(conf))
    if not norm_lines:
        return []

    line_lengths = np.fromiter((len(s) for s in norm_lines), dtype=np.int64, count=len(norm_lines))
    key_lengths = table.key_lengths

    # One vectorised call scores every (line, key) pair; entries below the
    # cutoff come back as 0. workers=-1 spreads the ~37k keys over all cores.
    scores = process.cdist(
        norm_lines, table.keys, scorer=fuzz.ratio, score_cutoff=min_score, workers=-1
    ).astype(np.float32, copy=False)

    # Short-name guards, applied as masks over the whole matrix.
    short_keys = key_lengths < short_len
    if short_keys.any():
        len_ok = np.abs(line_lengths[:, None] - key_lengths[None, :]) <= 1
        exact = scores >= 100
        scores[:, short_keys] = np.where(
            exact[:, short_keys] & len_ok[:, short_keys], scores[:, short_keys], 0
        )
    mid_keys = (key_lengths >= short_len) & (key_lengths < mid_len)
    if mid_keys.any():
        scores[:, mid_keys] = np.where(scores[:, mid_keys] >= mid_score, scores[:, mid_keys], 0)

    # Secondary partial pass: long keys only, and only where the line is longer
    # than the key. (A *shorter* line would be a truncated read, and letting
    # "fire" match every name containing it is exactly what we must avoid.)
    partial = np.zeros_like(scores, dtype=bool)
    long_keys = np.flatnonzero(key_lengths >= partial_min_len)
    long_lines = np.flatnonzero(line_lengths > partial_min_len)
    if long_keys.size and long_lines.size:
        sub_keys = [table.keys[i] for i in long_keys]
        sub_lines = [norm_lines[i] for i in long_lines]
        p_scores = process.cdist(
            sub_lines,
            sub_keys,
            scorer=fuzz.partial_ratio,
            score_cutoff=partial_min_score,
            workers=-1,
        ).astype(np.float32, copy=False)
        longer = line_lengths[long_lines][:, None] > key_lengths[long_keys][None, :]
        covers = (
            key_lengths[long_keys][None, :]
            >= partial_min_coverage * line_lengths[long_lines][:, None]
        )
        p_scores = np.where(longer & covers, p_scores, 0)
        block = scores[np.ix_(long_lines, long_keys)]
        improved = p_scores > block
        scores[np.ix_(long_lines, long_keys)] = np.where(improved, p_scores, block)
        partial[np.ix_(long_lines, long_keys)] = improved

    # Rank by score × OCR confidence so a clean read of a plausible name beats
    # a garbage read that happens to be close to some key.
    conf_arr = np.asarray(confs, dtype=np.float32)
    weighted = scores * conf_arr[:, None]
    candidate_keys = np.flatnonzero(scores.max(axis=0) > 0)
    if candidate_keys.size == 0:
        return []

    hits: list[tuple[float, NameHit]] = []
    for k in candidate_keys:
        col = weighted[:, k]
        best_line = int(np.argmax(col))
        hits.append(
            (
                float(col[best_line]),
                NameHit(
                    key=table.keys[k],
                    score=float(scores[best_line, k]),
                    line_conf=confs[best_line],
                    line_text=raw_lines[best_line],
                    partial=bool(partial[best_line, k]),
                ),
            )
        )
    # Stable sort so equal weights keep alphabetical key order (deterministic).
    hits.sort(key=lambda t: -t[0])

    kept: list[NameHit] = []
    for i, (weight, hit) in enumerate(hits):
        if i < top_m:
            kept.append(hit)
            continue
        # Near-ties with the last *kept* key also enter the shortlist.
        last_weight = hits[len(kept) - 1][0]
        if weight >= last_weight - ambiguity_gap:
            kept.append(hit)
        else:
            break
    return kept


# --- Collector line -----------------------------------------------------------


@dataclass(frozen=True)
class CollectorHit:
    """A parsed collector line.

    Attributes:
        number: Normalised collector number (see
            :func:`normalize_collector_number`), e.g. ``"150"`` or ``"223"``.
        base: The number with trailing letters removed (family lookup).
        set_code: Lower-case set code validated against the index, or None.
        lang: Two-letter printed language code as read (``"EN"``), or None.
        rarity: Rarity letter as printed (``"R"``), or None.
        total: Set total from an ``x/yyy`` number, or None.
        confidence: Mean OCR confidence of the lines used.
    """

    number: str
    base: str
    set_code: str | None
    lang: str | None
    rarity: str | None
    total: str | None
    confidence: float


_RARITY = r"[CURMSTLP]"
_NUM = r"\d{1,4}[A-Za-z]?"

# "0150 R", "150/274 R", "184/261C", "078 R", "432", "*223/249" (star stripped).
NUM_LINE = re.compile(rf"^(?P<num>{_NUM})(?:/(?P<total>\d{{1,4}}))?\s*(?P<rar>{_RARITY})?$")
# "M 0117", "U 0281", "U0258" (rarity first, with or without a space).
RAR_FIRST = re.compile(rf"^(?P<rar>{_RARITY})\s*(?P<num>{_NUM})$")
# "TLA • EN", "DMR•EN ADAM REX", "STA.JP", "TLE •EN B3: FIRE".
SET_LINE = re.compile(r"^(?P<set>[A-Z0-9]{2,6})\s*[•.\-\s]\s*(?P<lang>[A-Z]{2})\b")
# Number and set line merged into one OCR box: "0150 R TLA • EN".
NUM_SET_LINE = re.compile(
    rf"^(?P<num>{_NUM})(?:/(?P<total>\d{{1,4}}))?\s*(?P<rar>{_RARITY})?\s+"
    r"(?P<set>[A-Z0-9]{2,6})\s*[•.\-\s]\s*(?P<lang>[A-Z]{2})\b"
)
# Older frames print the number at the end of the copyright line:
# "™ & © 2023 Wizards of the Coast 280" or "... Wizards of the Coast, Inc. 280/383".
WIZARDS_LINE = re.compile(rf"WIZARDS\b.*\s(?P<num>{_NUM})(?:/(?P<total>\d{{1,4}}))?\s*$")

# The set total on "x/yyy" must be at least this to count as a set size rather
# than a power/toughness box ("2/2", "6/6").
_MIN_SET_TOTAL = 50
# A trailing 4-digit number in this range on the copyright line is the year.
_YEAR_MIN, _YEAR_MAX = 1993, 2099

_BULLETS = re.compile(r"[•·●∙]")
_STARS = re.compile(r"[*★†]")
_SPACES = re.compile(r"\s+")

# Glyph pairs OCR swaps in the small set-code font. Both directions are tried
# because the misread can go either way ("0" for "O" on TLA is as likely as
# "O" for "0" on M20).
_CONFUSIONS: dict[str, str] = {
    "O": "0",
    "0": "O",
    "I": "1",
    "1": "I",
    "S": "5",
    "5": "S",
    "B": "8",
    "8": "B",
    "Z": "2",
    "2": "Z",
}
_MAX_VARIANTS = 8


def _clean_line(text: str) -> str:
    """Upper-case, unify bullet glyphs, strip promo stars and collapse spaces."""
    s = _BULLETS.sub("•", text.upper())
    s = _STARS.sub("", s)
    return _SPACES.sub(" ", s).strip()


def set_code_variants(token: str) -> list[str]:
    """The token itself followed by up to ``_MAX_VARIANTS`` confusion variants.

    Single-character substitutions come first (most misreads are one glyph),
    then double substitutions, in left-to-right position order. Lower-cased,
    duplicates removed, so callers can test membership in ``set_codes`` directly.
    """
    token = token.upper()
    positions = [i for i, ch in enumerate(token) if ch in _CONFUSIONS]
    variants: list[str] = [token.lower()]
    seen = {token.lower()}

    def _add(chars: list[str]) -> bool:
        v = "".join(chars).lower()
        if v not in seen:
            seen.add(v)
            variants.append(v)
        return len(variants) - 1 >= _MAX_VARIANTS

    chars = list(token)
    for i in positions:
        swapped = chars.copy()
        swapped[i] = _CONFUSIONS[chars[i]]
        if _add(swapped):
            return variants
    for a_idx, i in enumerate(positions):
        for j in positions[a_idx + 1 :]:
            swapped = chars.copy()
            swapped[i] = _CONFUSIONS[chars[i]]
            swapped[j] = _CONFUSIONS[chars[j]]
            if _add(swapped):
                return variants
    return variants


def _validate_set(token: str, set_codes: frozenset[str]) -> str | None:
    """Return the known set code the OCR'd token most plausibly is, or None."""
    for variant in set_code_variants(token):
        if variant in set_codes:
            return variant
    return None


@dataclass
class _NumberRead:
    number: str
    base: str
    rarity: str | None
    total: str | None
    conf: float
    qualified: bool  # rarity / plausible total / copyright context present


@dataclass
class _SetRead:
    set_code: str
    lang: str
    conf: float


def _read_number(
    m: re.Match, conf: float, *, context_qualifies: bool = False
) -> _NumberRead | None:
    """Turn a regex match with ``num``/``total``/``rar`` groups into a read."""
    raw = m.group("num")
    total = m.groupdict().get("total")
    rarity = m.groupdict().get("rar")
    if total is not None and int(total) < _MIN_SET_TOTAL:
        # "2/2", "6/6": a power/toughness box, never a collector number.
        return None
    number, base = normalize_collector_number(raw)
    if not number:
        return None
    qualified = bool(rarity) or total is not None or context_qualifies
    return _NumberRead(number, base, rarity, total, conf, qualified)


def parse_collector_line(
    lines: list[tuple[str, float]], set_codes: frozenset[str]
) -> CollectorHit | None:
    """Parse the collector number / set line out of OCR lines.

    A bare 1–4 digit number is never accepted on its own: it could be a year,
    a power/toughness value or a mana cost. It needs a rarity letter, a set
    total (``150/274``, total ≥ 50), the copyright-line context (``"... Wizards
    of the Coast 280"``) or a validated set line found on *any* line. Number
    and set fragments are combined across lines; when several candidates
    exist the qualified, higher-confidence one wins. Set codes are validated
    against ``set_codes`` (trying OCR confusion variants), so an unknown or
    unrepairable code is treated as no set line at all — that also keeps rules
    text such as ``"IF AN"`` from being read as a set/language pair.

    Returns None when no number could be established.
    """
    numbers: list[_NumberRead] = []
    sets: list[_SetRead] = []

    for text, conf in lines:
        if conf is None or conf < 0 or not text:
            continue
        conf = float(conf)
        s = _clean_line(text)
        if not s:
            continue

        if m := NUM_SET_LINE.match(s):
            set_code = _validate_set(m.group("set"), set_codes)
            read = _read_number(m, conf, context_qualifies=set_code is not None)
            if read is not None:
                numbers.append(read)
            if set_code is not None:
                sets.append(_SetRead(set_code, m.group("lang"), conf))
            continue
        if (m := NUM_LINE.match(s)) or (m := RAR_FIRST.match(s)):
            read = _read_number(m, conf)
            if read is not None:
                numbers.append(read)
            continue
        if m := WIZARDS_LINE.search(s):
            raw = m.group("num")
            if raw.isdigit() and _YEAR_MIN <= int(raw) <= _YEAR_MAX and m.group("total") is None:
                continue  # "... Wizards of the Coast 1995" is the year, not a number
            read = _read_number(m, conf, context_qualifies=True)
            if read is not None:
                numbers.append(read)
            continue
        if m := SET_LINE.match(s):
            set_code = _validate_set(m.group("set"), set_codes)
            if set_code is not None:
                sets.append(_SetRead(set_code, m.group("lang"), conf))

    if not numbers:
        return None
    best_set = max(sets, key=lambda r: r.conf) if sets else None
    # Qualified reads first, then OCR confidence.
    best_num = max(numbers, key=lambda r: (r.qualified, r.conf))
    if not best_num.qualified and best_set is None:
        return None

    used = [best_num.conf] + ([best_set.conf] if best_set else [])
    return CollectorHit(
        number=best_num.number,
        base=best_num.base,
        set_code=best_set.set_code if best_set else None,
        lang=best_set.lang if best_set else None,
        rarity=best_num.rarity,
        total=best_num.total,
        confidence=float(sum(used) / len(used)),
    )


def lookup_collector(
    hit: CollectorHit, table: NameTable, name_rows: np.ndarray | None = None
) -> np.ndarray:
    """Resolve a collector hit to index row positions.

    The ladder, first non-empty rung wins:

    1. ``(set, number)`` exact — the printing itself.
    2. ``(set, base)`` — the promo/prerelease family sharing the printed number
       (``150`` also finds ``150s``), or a number whose suffix letter was
       misread.
    3. ``number ∩ name_rows`` — no usable set code (or the set rungs found
       nothing), but the number agrees with a card the name pass matched. The
       intersection is what makes a set-less number safe: on its own ``120``
       would fan out to every set ever printed.
    4. ``base ∩ name_rows`` — as 3 with the family number.
    5. Empty.

    Rungs 3–4 need ``name_rows`` (the union of rows of the name hits); without
    it a set-less hit resolves to nothing rather than to hundreds of rows.
    """
    if hit.set_code:
        rows = table.rows_by_set_cn.get((hit.set_code, hit.number))
        if rows is not None and rows.size:
            return rows
        rows = table.rows_by_set_base.get((hit.set_code, hit.base))
        if rows is not None and rows.size:
            return rows
    if name_rows is not None and len(name_rows):
        name_rows = np.asarray(name_rows, dtype=np.int64)
        for candidates in (table.rows_by_cn.get(hit.number), table.rows_by_cn_base.get(hit.base)):
            if candidates is None:
                continue
            both = np.intersect1d(candidates, name_rows)
            if both.size:
                return both
    return _EMPTY_ROWS

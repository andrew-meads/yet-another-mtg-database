"""
PostgreSQL index of Scryfall card images for identification.

One row per card *face* (true double-faced cards get one row per face). Each row
stores lightweight metadata, the 64-bit Stage-1 pHash (8 raw bytes in a BYTEA),
the serialized Stage-2 feature descriptors + keypoint positions, and — since the
OCR stage — normalised text metadata (name keys, collector-number forms, layout,
language, illustration id, …) that lets a recognised name or collector line be
turned into candidate rows without touching images.

Access is through a module-level **psycopg (v3) connection pool — no ORM**. The
schema is three tables and the read hot path bulk-loads every hash into a NumPy
array, so raw SQL is the natural, low-overhead fit. The pool is created lazily
and shared across the process (the API server and the indexer CLI are separate
processes, each with their own pool, both pointed at the same Postgres).
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass

import numpy as np
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import config

# Schema. `UNIQUE (scryfall_id, face)` lets re-runs upsert instead of duplicating
# and lets a DFC store its two faces under the same Scryfall id. `indexed_sets`
# records completed sets so a bulk build can skip them and resume.
_CARDS_TABLE = """
CREATE TABLE IF NOT EXISTS cards (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scryfall_id      TEXT NOT NULL,
    oracle_id        TEXT,
    name             TEXT NOT NULL,
    set_code         TEXT,
    collector_number TEXT,
    face             TEXT,
    image_url        TEXT,
    scryfall_uri     TEXT,
    phash            BYTEA NOT NULL,
    kp_pts           BYTEA,
    descriptors      BYTEA,
    UNIQUE (scryfall_id, face)
);
"""

_SETS_TABLE = """
CREATE TABLE IF NOT EXISTS indexed_sets (
    set_code   TEXT PRIMARY KEY,
    faces      INTEGER,
    card_count INTEGER,          -- Scryfall's set card_count when last indexed
    updated_at TIMESTAMPTZ DEFAULT now()
);
"""

# Small key/value table for index-wide facts (e.g. which metadata backfill has
# run). Its `updated_at` is part of the matcher's change signature, so a
# metadata-only backfill (which adds no rows and touches no set) still triggers a
# cache reload.
_META_TABLE = """
CREATE TABLE IF NOT EXISTS index_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);
"""

# Idempotent migration for DBs created before card_count existed.
_SETS_MIGRATE = "ALTER TABLE indexed_sets ADD COLUMN IF NOT EXISTS card_count INTEGER;"

# Text-metadata columns added for the OCR stage. All nullable so a pre-existing
# index keeps working (rows are filled by `app.backfill_metadata` or by
# `build_index` for newly indexed sets). Column semantics (see app/metadata.py):
#   name_key / face_name_keys  normalised name(s) OCR lines are matched against
#   collector_number_norm/base "0117" -> "117"; "224s" -> base "224"
#   illustration_id            groups identical-art printings
METADATA_COLUMNS: tuple[str, ...] = (
    "layout",
    "lang",
    "printed_name",
    "flavor_name",
    "name_key",
    "face_name_keys",
    "collector_number_norm",
    "collector_number_base",
    "illustration_id",
    "frame",
    "border_color",
    "full_art",
    "textless",
    "promo_types",
    "meta_version",
)
_METADATA_COLUMN_TYPES = {
    "face_name_keys": "TEXT[]",
    "full_art": "BOOLEAN",
    "textless": "BOOLEAN",
    "promo_types": "TEXT[]",
    "meta_version": "INTEGER",
}
_CARDS_MIGRATE = [
    f"ALTER TABLE cards ADD COLUMN IF NOT EXISTS {col} {_METADATA_COLUMN_TYPES.get(col, 'TEXT')};"
    for col in METADATA_COLUMNS
] + [
    "CREATE INDEX IF NOT EXISTS cards_name_key_idx ON cards (name_key);",
    "CREATE INDEX IF NOT EXISTS cards_set_cn_idx ON cards (set_code, collector_number_norm);",
    "CREATE INDEX IF NOT EXISTS cards_illustration_idx ON cards (illustration_id);",
]

# Version of the text-metadata derivation (app/metadata.py). Stamped into
# `cards.meta_version` by the backfill and by build_index, and recorded in
# index_meta("metadata_version"), so a future change to how keys are derived can
# find rows that need re-deriving without re-downloading anything.
METADATA_VERSION = 1

# Lazily-created shared pool.
_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    """Return the shared connection pool, creating + opening it on first use."""
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            conninfo=config.DATABASE_URL,
            min_size=1,
            max_size=10,
            timeout=10,  # max seconds to wait for a connection
            open=False,
            kwargs={"row_factory": dict_row},  # rows come back as dicts
        )
        _pool.open()
    return _pool


def close_pool() -> None:
    """Close the pool (on app shutdown)."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connection():
    """Borrow a pooled connection; committed/returned automatically on exit."""
    with get_pool().connection() as conn:
        yield conn


def init_db(retries: int = 5, delay: float = 1.0) -> None:
    """Create tables / columns if absent. Retries briefly in case the DB is still warming."""
    last_err: Exception | None = None
    for _ in range(retries):
        try:
            with connection() as conn:
                conn.execute(_CARDS_TABLE)
                conn.execute(_SETS_TABLE)
                conn.execute(_META_TABLE)
                conn.execute(_SETS_MIGRATE)
                for stmt in _CARDS_MIGRATE:
                    conn.execute(stmt)
                conn.commit()
            return
        except Exception as err:  # DB not ready yet, transient network, etc.
            last_err = err
            time.sleep(delay)
    raise RuntimeError(f"could not initialize database: {last_err}")


def upsert_card(
    conn,
    *,
    scryfall_id: str,
    oracle_id: str | None,
    name: str,
    set_code: str | None,
    collector_number: str | None,
    face: str,
    image_url: str | None,
    scryfall_uri: str | None,
    phash: int,
    kp_pts: bytes | None,
    descriptors: bytes | None,
    metadata: dict | None = None,
) -> None:
    """Insert or update one card-face row (keyed by scryfall_id + face).

    ``metadata`` (see :func:`app.metadata.face_metadata`) fills the text-metadata
    columns; when omitted those columns are left untouched, so callers that only
    know the image-derived fields never wipe a backfill.
    """
    columns = [
        "scryfall_id",
        "oracle_id",
        "name",
        "set_code",
        "collector_number",
        "face",
        "image_url",
        "scryfall_uri",
        "phash",
        "kp_pts",
        "descriptors",
    ]
    values: list = [
        scryfall_id,
        oracle_id,
        name,
        set_code,
        collector_number,
        face,
        image_url,
        scryfall_uri,
        int(phash).to_bytes(8, "big"),
        kp_pts,
        descriptors,
    ]
    if metadata is not None:
        for col in METADATA_COLUMNS:
            if col in metadata:
                columns.append(col)
                values.append(metadata[col])
    # scryfall_id/face form the conflict key; everything else is updated.
    updates = ", ".join(f"{c}=EXCLUDED.{c}" for c in columns if c not in ("scryfall_id", "face"))
    conn.execute(
        f"INSERT INTO cards ({', '.join(columns)}) VALUES ({', '.join('%s' for _ in columns)}) "
        f"ON CONFLICT (scryfall_id, face) DO UPDATE SET {updates}",
        values,
    )


def update_metadata(conn, row_id: int, metadata: dict) -> None:
    """Write the text-metadata columns of one row (used by the backfill)."""
    cols = [c for c in METADATA_COLUMNS if c in metadata]
    if not cols:
        return
    conn.execute(
        f"UPDATE cards SET {', '.join(f'{c}=%s' for c in cols)} WHERE id=%s",
        [metadata[c] for c in cols] + [row_id],
    )


def count(conn) -> int:
    """Total number of indexed card faces."""
    return conn.execute("SELECT COUNT(*) AS n FROM cards").fetchone()["n"]


def mark_set_done(conn, set_code: str, faces: int, card_count: int | None = None) -> None:
    """Record that a set has been fully indexed (for resumable bulk builds).

    ``card_count`` is Scryfall's set card count at index time; storing it lets a
    later bulk run detect when a still-releasing set has gained cards.
    """
    conn.execute(
        """
        INSERT INTO indexed_sets (set_code, faces, card_count) VALUES (%s, %s, %s)
        ON CONFLICT (set_code) DO UPDATE SET
            faces=EXCLUDED.faces, card_count=EXCLUDED.card_count, updated_at=now()
        """,
        (set_code, faces, card_count),
    )


def is_set_done(conn, set_code: str) -> bool:
    """Whether a set has been recorded as fully indexed."""
    return (
        conn.execute("SELECT 1 FROM indexed_sets WHERE set_code = %s", (set_code,)).fetchone()
        is not None
    )


def set_card_count(conn, set_code: str) -> int | None:
    """The Scryfall card_count recorded when this set was last indexed (or None)."""
    row = conn.execute(
        "SELECT card_count FROM indexed_sets WHERE set_code = %s", (set_code,)
    ).fetchone()
    return row["card_count"] if row else None


def delete_set(conn, set_code: str) -> int:
    """Delete all indexed rows for a set; returns how many were removed.

    Used to wipe a set before re-indexing it (e.g. its card count changed). Run
    in the same transaction as the rebuild so readers see an atomic swap.
    """
    return conn.execute("DELETE FROM cards WHERE set_code = %s", (set_code,)).rowcount


def backfill_card_count(conn, set_code: str, card_count: int | None) -> None:
    """Record a card_count for an already-indexed set without re-indexing it.

    For sets indexed before card_count tracking existed: assume the existing index
    is complete and just store the count so future runs can change-detect, rather
    than wastefully re-downloading them.
    """
    conn.execute("UPDATE indexed_sets SET card_count=%s WHERE set_code=%s", (card_count, set_code))


def set_meta(conn, key: str, value: str) -> None:
    """Upsert an index-wide fact; bumps `updated_at` (and so the change signature)."""
    conn.execute(
        """
        INSERT INTO index_meta (key, value) VALUES (%s, %s)
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()
        """,
        (key, value),
    )


def get_meta(conn, key: str) -> str | None:
    """Read an index-wide fact (None if unset)."""
    row = conn.execute("SELECT value FROM index_meta WHERE key = %s", (key,)).fetchone()
    return row["value"] if row else None


def index_signature(conn) -> tuple:
    """A cheap change-token for the matcher cache.

    ``(row count, latest set update, latest meta update)``: changes whenever cards
    are added, any set is (re)indexed, or a metadata backfill runs — so the matcher
    can detect a running build or backfill and reload without re-querying every
    request.
    """
    row = conn.execute(
        "SELECT (SELECT COUNT(*) FROM cards) AS n, "
        "(SELECT MAX(updated_at) FROM indexed_sets) AS ts, "
        "(SELECT MAX(updated_at) FROM index_meta) AS meta_ts"
    ).fetchone()
    return (row["n"], row["ts"], row["meta_ts"])


def load_hashes(conn) -> tuple[np.ndarray, np.ndarray]:
    """Load all (id, pHash) pairs for the Stage-1 brute-force scan.

    Returns:
        ``(ids, hashes)`` — parallel ``int64`` and ``uint64`` arrays.
    """
    rows = conn.execute("SELECT id, phash FROM cards").fetchall()
    ids = np.array([r["id"] for r in rows], dtype=np.int64)
    hashes = np.array([int.from_bytes(bytes(r["phash"]), "big") for r in rows], dtype=np.uint64)
    return ids, hashes


@dataclass
class Stage1Data:
    """Everything the in-memory Stage-1 cache needs, in row order.

    ``ids``/``hashes`` drive the Hamming scan; the parallel lists feed the name /
    collector-number lookup tables (see :class:`app.names.NameTable`). Only the
    small text columns are loaded here — the heavy feature blobs and display
    metadata are fetched per shortlist row by :func:`load_rows`.
    """

    ids: np.ndarray
    hashes: np.ndarray
    name_key: list[str | None]
    face_name_keys: list[list[str]]
    set_code: list[str | None]
    cn_norm: list[str | None]
    cn_base: list[str | None]
    oracle_id: list[str | None]


def load_stage1(conn) -> Stage1Data:
    """Load the Stage-1 arrays plus the text metadata for the name tables."""
    rows = conn.execute(
        "SELECT id, phash, name_key, face_name_keys, set_code, collector_number_norm, "
        "collector_number_base, oracle_id FROM cards ORDER BY id"
    ).fetchall()
    return Stage1Data(
        ids=np.array([r["id"] for r in rows], dtype=np.int64),
        hashes=np.array([int.from_bytes(bytes(r["phash"]), "big") for r in rows], dtype=np.uint64),
        name_key=[r["name_key"] for r in rows],
        face_name_keys=[list(r["face_name_keys"] or ()) for r in rows],
        set_code=[r["set_code"] for r in rows],
        cn_norm=[r["collector_number_norm"] for r in rows],
        cn_base=[r["collector_number_base"] for r in rows],
        oracle_id=[r["oracle_id"] for r in rows],
    )


def load_rows(conn, ids: list[int]) -> dict[int, dict]:
    """Load full rows (metadata + feature BLOBs) for the shortlisted ids.

    Uses the binary result format: the descriptor blobs are ~20 KB per row and the
    default text protocol hex-encodes BYTEA, doubling the bytes on the wire and the
    decode work — measured as half of Stage 2's latency.
    """
    if not ids:
        return {}
    # `= ANY(%s)` with a Python list lets psycopg adapt it to a Postgres array —
    # no need to build a variable number of placeholders.
    rows = conn.execute(
        "SELECT * FROM cards WHERE id = ANY(%s)", (list(ids),), binary=True
    ).fetchall()
    return {r["id"]: r for r in rows}


def metadata_coverage(conn) -> tuple[int, int]:
    """``(rows with name_key, total rows)`` — how complete the text metadata is."""
    row = conn.execute("SELECT COUNT(name_key) AS filled, COUNT(*) AS total FROM cards").fetchone()
    return row["filled"], row["total"]

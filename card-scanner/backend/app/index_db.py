"""
PostgreSQL index of Scryfall card images for identification.

One row per card *face* (true double-faced cards get one row per face). Each row
stores lightweight metadata, the 64-bit Stage-1 pHash (8 raw bytes in a BYTEA),
and the serialized Stage-2 feature descriptors + keypoint positions.

Access is through a module-level **psycopg (v3) connection pool — no ORM**. The
schema is two tables and the read hot path bulk-loads every hash into a NumPy
array, so raw SQL is the natural, low-overhead fit. The pool is created lazily
and shared across the process (the API server and the indexer CLI are separate
processes, each with their own pool, both pointed at the same Postgres).
"""

from __future__ import annotations

import time
from contextlib import contextmanager

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

# Idempotent migration for DBs created before card_count existed.
_SETS_MIGRATE = "ALTER TABLE indexed_sets ADD COLUMN IF NOT EXISTS card_count INTEGER;"

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
            timeout=10,                       # max seconds to wait for a connection
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
    """Create tables if absent. Retries briefly in case the DB is still warming."""
    last_err: Exception | None = None
    for _ in range(retries):
        try:
            with connection() as conn:
                conn.execute(_CARDS_TABLE)
                conn.execute(_SETS_TABLE)
                conn.execute(_SETS_MIGRATE)
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
) -> None:
    """Insert or update one card-face row (keyed by scryfall_id + face)."""
    conn.execute(
        """
        INSERT INTO cards (scryfall_id, oracle_id, name, set_code, collector_number,
                           face, image_url, scryfall_uri, phash, kp_pts, descriptors)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (scryfall_id, face) DO UPDATE SET
            oracle_id=EXCLUDED.oracle_id, name=EXCLUDED.name, set_code=EXCLUDED.set_code,
            collector_number=EXCLUDED.collector_number, image_url=EXCLUDED.image_url,
            scryfall_uri=EXCLUDED.scryfall_uri, phash=EXCLUDED.phash,
            kp_pts=EXCLUDED.kp_pts, descriptors=EXCLUDED.descriptors
        """,
        (
            scryfall_id, oracle_id, name, set_code, collector_number, face,
            image_url, scryfall_uri, int(phash).to_bytes(8, "big"), kp_pts, descriptors,
        ),
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
        conn.execute(
            "SELECT 1 FROM indexed_sets WHERE set_code = %s", (set_code,)
        ).fetchone()
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
    conn.execute(
        "UPDATE indexed_sets SET card_count=%s WHERE set_code=%s", (card_count, set_code)
    )


def index_signature(conn) -> tuple:
    """A cheap change-token for the matcher cache: (row count, latest set update).

    Changes whenever cards are added or any set is (re)indexed, so the matcher can
    detect a running build and reload without re-querying every request.
    """
    row = conn.execute(
        "SELECT (SELECT COUNT(*) FROM cards) AS n, "
        "(SELECT MAX(updated_at) FROM indexed_sets) AS ts"
    ).fetchone()
    return (row["n"], row["ts"])


def load_hashes(conn) -> tuple[np.ndarray, np.ndarray]:
    """Load all (id, pHash) pairs for the Stage-1 brute-force scan.

    Returns:
        ``(ids, hashes)`` — parallel ``int64`` and ``uint64`` arrays.
    """
    rows = conn.execute("SELECT id, phash FROM cards").fetchall()
    ids = np.array([r["id"] for r in rows], dtype=np.int64)
    hashes = np.array(
        [int.from_bytes(bytes(r["phash"]), "big") for r in rows], dtype=np.uint64
    )
    return ids, hashes


def load_rows(conn, ids: list[int]) -> dict[int, dict]:
    """Load full rows (metadata + feature BLOBs) for the shortlisted ids."""
    if not ids:
        return {}
    # `= ANY(%s)` with a Python list lets psycopg adapt it to a Postgres array —
    # no need to build a variable number of placeholders.
    rows = conn.execute(
        "SELECT * FROM cards WHERE id = ANY(%s)", (list(ids),)
    ).fetchall()
    return {r["id"]: r for r in rows}

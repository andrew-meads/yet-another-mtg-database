"""
Integration tests for ``app.index_db`` and the matcher against a real Postgres.

Opt-in: run with ``SCANNER_INTEGRATION=1``. Uses a scratch database — by default
``cardscanner_test`` on the same server as the live index, created on the fly via the
``postgres`` maintenance database with the same credentials — and never touches the
live ``cardscanner`` database. Override with ``SCANNER_TEST_DATABASE_URL``.
"""

from __future__ import annotations

import os
from urllib.parse import urlsplit, urlunsplit

import numpy as np
import pytest
from conftest import fake_card_image, perspective_jitter

from app import config, features, hashing, index_db, matcher

pytestmark = pytest.mark.integration

_DEFAULT_URL = "postgresql://cardscanner:cardscanner@localhost:5432/cardscanner_test"


def _ensure_database(url: str) -> None:
    """Create the scratch database named in ``url`` if it does not exist yet."""
    import psycopg

    parts = urlsplit(url)
    dbname = parts.path.lstrip("/")
    assert dbname and dbname != "cardscanner", "refusing to run integration tests on the live DB"
    maintenance = urlunsplit(parts._replace(path="/postgres"))
    with psycopg.connect(maintenance, autocommit=True, connect_timeout=5) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{dbname}"')


@pytest.fixture(scope="module")
def scratch_db():
    """Point ``config.DATABASE_URL`` (and a fresh pool) at an empty scratch database."""
    url = os.environ.get("SCANNER_TEST_DATABASE_URL", _DEFAULT_URL)
    _ensure_database(url)
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(config, "DATABASE_URL", url)
        index_db.close_pool()  # drop any pool built for the old URL
        index_db.init_db(retries=1)
        with index_db.connection() as conn:
            conn.execute("DROP TABLE IF EXISTS cards")
            conn.execute("DROP TABLE IF EXISTS indexed_sets")
            conn.commit()
        index_db.init_db(retries=1)
        yield url
        index_db.close_pool()


@pytest.fixture
def clean_tables(scratch_db):
    with index_db.connection() as conn:
        conn.execute("DELETE FROM cards")
        conn.execute("DELETE FROM indexed_sets")
        conn.commit()


def _upsert_fake(conn, index: int, *, oracle_id: str | None = None) -> np.ndarray:
    image = fake_card_image(index)
    keypoints, descriptors = features.compute_descriptors(image)
    kp_blob, desc_blob = features.serialize_features(keypoints, descriptors)
    index_db.upsert_card(
        conn,
        scryfall_id=f"fake-{index}",
        oracle_id=oracle_id or f"oracle-{index}",
        name=f"Fake Card {index}",
        set_code="fak",
        collector_number=str(index),
        face="single",
        image_url=None,
        scryfall_uri=None,
        phash=hashing.compute_phash(image),
        kp_pts=kp_blob,
        descriptors=desc_blob,
    )
    return image


def test_init_db_is_idempotent(scratch_db):
    index_db.init_db(retries=1)
    index_db.init_db(retries=1)
    with index_db.connection() as conn:
        assert index_db.count(conn) >= 0
        assert index_db.is_set_done(conn, "nope") is False


def test_upsert_twice_yields_one_row(clean_tables):
    with index_db.connection() as conn:
        _upsert_fake(conn, 0)
        _upsert_fake(conn, 0, oracle_id="oracle-updated")
        conn.commit()

        assert index_db.count(conn) == 1
        ids, _ = index_db.load_hashes(conn)
        (row,) = index_db.load_rows(conn, [int(ids[0])]).values()
        assert row["oracle_id"] == "oracle-updated"  # the second write updated in place


def test_load_hashes_and_rows_round_trip(clean_tables):
    with index_db.connection() as conn:
        images = {i: _upsert_fake(conn, i) for i in range(3)}
        conn.commit()

        ids, hashes = index_db.load_hashes(conn)
        assert ids.dtype == np.int64 and hashes.dtype == np.uint64
        assert len(ids) == len(hashes) == 3

        rows = index_db.load_rows(conn, [int(i) for i in ids])
        assert set(rows) == set(int(i) for i in ids)
        for row_id, stored_hash in zip(ids, hashes, strict=True):
            row = rows[int(row_id)]
            index = int(row["collector_number"])
            expected = hashing.compute_phash(images[index])
            assert int(stored_hash) == expected
            assert int.from_bytes(bytes(row["phash"]), "big") == expected
            pts, desc = features.deserialize_features(
                bytes(row["kp_pts"]), bytes(row["descriptors"])
            )
            assert pts.shape[0] == desc.shape[0] > 0
        assert index_db.load_rows(conn, []) == {}


def test_index_signature_changes_after_mark_set_done(clean_tables):
    with index_db.connection() as conn:
        before = index_db.index_signature(conn)
        index_db.mark_set_done(conn, "fak", faces=3, card_count=3)
        conn.commit()
        after = index_db.index_signature(conn)

        assert before != after
        assert index_db.is_set_done(conn, "fak") is True
        assert index_db.set_card_count(conn, "fak") == 3


def test_matcher_identifies_against_real_index(clean_tables, monkeypatch):
    """End to end: rows in Postgres -> cache load -> pHash shortlist -> ORB re-rank."""
    with index_db.connection() as conn:
        images = {i: _upsert_fake(conn, i) for i in range(3)}
        conn.commit()
    # Fresh cache so the matcher loads from the scratch database, not a stale table.
    monkeypatch.setattr(
        matcher, "_cache", {"sig": None, "checked_at": 0.0, "ids": None, "hashes": None}
    )

    assert matcher.index_size() == 3
    for index, image in images.items():
        results = matcher.identify(perspective_jitter(image, np.random.default_rng(index)))
        assert results[0]["scryfallId"] == f"fake-{index}"
        assert results[0]["confident"] is True

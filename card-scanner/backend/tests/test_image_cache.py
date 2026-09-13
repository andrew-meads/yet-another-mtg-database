"""Tests for the on-disk Scryfall image cache (app.image_cache).

The downloader is replaced by a counting fake, so nothing touches the network,
and the cache root is a per-test ``tmp_path`` set through ``config.IMAGE_CACHE_DIR``
(read at call time, so a plain monkeypatch is enough — no conftest needed).
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from app import config, image_cache, scryfall

SID = "0123abcd-4567-89ef-0123-456789abcdef"
URL = "https://cards.scryfall.io/normal/front/0/1/0123abcd.jpg"


def _jpeg_bytes(value: int = 100) -> bytes:
    ok, enc = cv2.imencode(".jpg", np.full((40, 30, 3), value, np.uint8))
    assert ok
    return enc.tobytes()


class Downloader:
    """Counting stand-in for ``scryfall.download_image_bytes``."""

    def __init__(self, payload: bytes | None = None) -> None:
        self.calls: list[str] = []
        self.payload = payload if payload is not None else _jpeg_bytes()

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        return self.payload


@pytest.fixture
def cache_dir(tmp_path, monkeypatch) -> Path:
    root = tmp_path / "cache"
    monkeypatch.setattr(config, "IMAGE_CACHE_DIR", root)
    monkeypatch.setattr(config, "SCRYFALL_IMAGE_FORMAT", "normal")
    return root


@pytest.fixture
def downloader(monkeypatch) -> Downloader:
    dl = Downloader()
    monkeypatch.setattr(scryfall, "download_image_bytes", dl)
    return dl


def test_cache_path_layout(cache_dir):
    assert image_cache.enabled()
    assert (
        image_cache.cache_path(SID, "single") == cache_dir / "normal" / "01" / f"{SID}_single.jpg"
    )
    assert image_cache.cache_path(SID, "back", fmt="large").parts[-3] == "large"


def test_miss_then_hit(cache_dir, downloader):
    data, hit = image_cache.fetch_bytes(SID, "single", URL)
    assert not hit and data == downloader.payload
    path = image_cache.cache_path(SID, "single")
    assert path.is_file() and path.read_bytes() == downloader.payload
    assert not list(path.parent.glob("*.tmp")), "temp file must not survive the atomic write"

    data2, hit2 = image_cache.fetch_bytes(SID, "single", URL)
    assert hit2 and data2 == data
    assert downloader.calls == [URL], "second read must be served from disk"

    assert image_cache.get_bytes(SID, "single", None) == data  # url optional on a hit
    img = image_cache.get_image(SID, "single", URL)
    assert img is not None and img.shape == (40, 30, 3)
    assert downloader.calls == [URL]


def test_faces_and_formats_do_not_collide(cache_dir, downloader):
    image_cache.get_bytes(SID, "front", URL)
    image_cache.get_bytes(SID, "back", URL)
    image_cache.get_bytes(SID, "front", URL, fmt="large")
    assert len(downloader.calls) == 3
    assert image_cache.stats() == {"files": 3, "bytes": 3 * len(downloader.payload)}


def test_corrupt_cached_file_is_redownloaded_once(cache_dir, downloader):
    path = image_cache.cache_path(SID, "single")
    path.parent.mkdir(parents=True)
    path.write_bytes(b"this is not a jpeg")

    img, hit = image_cache.fetch_image(SID, "single", URL)
    assert img is not None and not hit
    assert downloader.calls == [URL]
    assert path.read_bytes() == downloader.payload, "the good download replaces the corrupt file"

    # A genuinely undecodable payload from Scryfall yields None without looping.
    downloader.payload = b"still junk"
    path.write_bytes(b"corrupt again")
    img, _hit = image_cache.fetch_image(SID, "single", URL)
    assert img is None
    assert len(downloader.calls) == 2


def test_zero_byte_file_counts_as_miss(cache_dir, downloader):
    path = image_cache.cache_path(SID, "single")
    path.parent.mkdir(parents=True)
    path.write_bytes(b"")
    data, hit = image_cache.fetch_bytes(SID, "single", URL)
    assert not hit and data == downloader.payload
    assert path.read_bytes() == downloader.payload


def test_disabled_cache_downloads_every_time_and_writes_nothing(tmp_path, monkeypatch, downloader):
    monkeypatch.setattr(config, "IMAGE_CACHE_DIR", None)
    assert not image_cache.enabled()
    for _ in range(2):
        img, hit = image_cache.fetch_image(SID, "single", URL)
        assert img is not None and not hit
    assert len(downloader.calls) == 2
    assert not any(tmp_path.rglob("*.jpg"))
    assert image_cache.stats() == {"files": 0, "bytes": 0}
    assert list(image_cache.iter_cached()) == []
    with pytest.raises(RuntimeError):
        image_cache.cache_path(SID, "single")


def test_miss_without_url_returns_none(cache_dir, downloader):
    assert image_cache.get_bytes(SID, "single", None) is None
    assert image_cache.get_image(SID, "single", "") is None
    assert downloader.calls == []


def test_iter_cached_parses_names_and_skips_strays(cache_dir, downloader):
    other = "ffff0000-0000-0000-0000-000000000000"
    image_cache.get_bytes(other, "back", URL)
    image_cache.get_bytes(SID, "single", URL)
    image_cache.get_bytes(SID, "single", URL, fmt="large")
    (cache_dir / "normal" / "01" / "garbage.jpg.tmp").write_bytes(b"x")
    (cache_dir / "normal" / "01" / "noface.jpg").write_bytes(b"x")

    found = list(image_cache.iter_cached())
    assert found == sorted(found, key=lambda t: t[2])
    assert [(sid, face) for sid, face, _p in found] == [(SID, "single"), (other, "back")]
    assert all(p.is_file() for _s, _f, p in found)
    assert [(s, f) for s, f, _p in image_cache.iter_cached(fmt="large")] == [(SID, "single")]


def test_prune_by_age(cache_dir, downloader):
    import os
    import time

    image_cache.get_bytes(SID, "single", URL)
    image_cache.get_bytes(SID, "back", URL)
    old = image_cache.cache_path(SID, "back")
    ancient = time.time() - 400 * 86400
    os.utime(old, (ancient, ancient))

    removed, freed = image_cache.prune(365, dry_run=True)
    assert (removed, freed) == (1, len(downloader.payload))
    assert old.is_file()
    removed, _freed = image_cache.prune(365)
    assert removed == 1 and not old.is_file()
    assert image_cache.cache_path(SID, "single").is_file()


def test_warm_uses_face_resolution_and_sleeps_on_misses_only(cache_dir, downloader, monkeypatch):
    cards = [
        {"id": SID, "name": "One", "image_uris": {"normal": URL}},
        {
            "id": "2222aaaa-0000-0000-0000-000000000000",
            "name": "Two",
            "card_faces": [
                {"name": "Two // A", "image_uris": {"normal": URL + "?a"}},
                {"name": "Two // B", "image_uris": {"normal": URL + "?b"}},
            ],
        },
        {"id": "3333aaaa-0000-0000-0000-000000000000", "name": "No image"},
    ]
    monkeypatch.setattr(scryfall, "iter_set_cards", lambda code: iter(cards))
    sleeps: list[float] = []
    monkeypatch.setattr(image_cache.time, "sleep", lambda s: sleeps.append(s))

    downloaded, hits = image_cache.warm(["fak"], log=lambda *_: None)
    assert (downloaded, hits) == (3, 0)
    assert len(sleeps) == 3
    assert image_cache.stats()["files"] == 3

    downloaded, hits = image_cache.warm(["fak"], log=lambda *_: None)
    assert (downloaded, hits) == (0, 3)
    assert len(sleeps) == 3, "cache hits must not sleep"
    assert len(downloader.calls) == 3


def test_cli_stats_and_prune(cache_dir, downloader, capsys):
    image_cache.get_bytes(SID, "single", URL)
    assert image_cache.main(["stats"]) == 0
    out = capsys.readouterr().out
    assert "files: 1" in out and str(cache_dir) in out
    assert image_cache.main(["prune", "--older-than", "1", "--dry-run"]) == 0
    assert "would remove 0" in capsys.readouterr().out


def test_cli_disabled(monkeypatch, capsys):
    monkeypatch.setattr(config, "IMAGE_CACHE_DIR", None)
    assert image_cache.main(["stats"]) == 0
    assert image_cache.main(["warm", "--set", "fak"]) == 1
    assert "disabled" in capsys.readouterr().out

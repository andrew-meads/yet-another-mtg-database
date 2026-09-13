"""
On-disk cache of Scryfall card images.

Why: building the identification index, running the self-retrieval harness and
generating synthetic composites all need the same ~115k card images, and every
one of those jobs used to download them afresh (an index rebuild is hours of
mostly network time). With the cache, an image is fetched from Scryfall once and
every later consumer reads it from disk; the Scryfall request throttle then only
applies to cache *misses*.

Layout (``fmt`` is the Scryfall image size, ``normal`` by default)::

    <IMAGE_CACHE_DIR>/<fmt>/<sid[:2]>/<scryfall_id>_<face>.jpg

The two-character prefix directory keeps any single directory to a few hundred
entries (115k files in one directory makes ``ls`` and Finder crawl). Files are
written atomically (temp file in the same directory + ``os.replace``) so a killed
build never leaves a truncated image that later reads as "corrupt"; if one does
appear (disk trouble, manual copy), :func:`get_image` deletes it and re-downloads
once.

Cost: a full ``normal`` cache is about 7.5 GB (≈ 65 KB per face); ``large`` is
roughly 3× that. Fill it deliberately with ``warm --set CODE`` or let it grow as
sets are indexed. ``IMAGE_CACHE_DIR=""`` disables the cache: every call goes
straight to Scryfall and nothing is written.

CLI::

    python -m app.image_cache stats
    python -m app.image_cache prune --older-than 90 [--dry-run]
    python -m app.image_cache warm --set tla tle [--fmt large]
"""

from __future__ import annotations

import argparse
import contextlib
import os
import sys
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from . import config, scryfall

# Cached files always carry this suffix regardless of what Scryfall's CDN URL
# ends with: every supported image size is served as JPEG.
_SUFFIX = ".jpg"


def enabled() -> bool:
    """Whether a cache directory is configured (``IMAGE_CACHE_DIR`` not empty)."""
    return config.IMAGE_CACHE_DIR is not None


def _root() -> Path:
    if config.IMAGE_CACHE_DIR is None:
        raise RuntimeError("image cache is disabled (IMAGE_CACHE_DIR is empty)")
    return Path(config.IMAGE_CACHE_DIR)


def cache_path(scryfall_id: str, face: str, fmt: str | None = None) -> Path:
    """Where the image of ``face`` of card ``scryfall_id`` lives (whether or not cached).

    ``fmt`` defaults to ``config.SCRYFALL_IMAGE_FORMAT``; different sizes of the
    same card never collide because the size is the first path component.
    Raises ``RuntimeError`` when the cache is disabled.
    """
    fmt = fmt or config.SCRYFALL_IMAGE_FORMAT
    return _root() / fmt / scryfall_id[:2] / f"{scryfall_id}_{face}{_SUFFIX}"


def _write_atomic(path: Path, data: bytes) -> None:
    """Write ``data`` to ``path`` so readers never observe a partial file.

    The temp file is created in the destination directory so ``os.replace`` is a
    same-filesystem rename (atomic on POSIX and NTFS). On failure the temp file is
    removed and the error propagates — a failed write must not leave junk behind.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp_name, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp_name)
        raise


def fetch_bytes(
    scryfall_id: str, face: str, url: str | None, *, fmt: str | None = None
) -> tuple[bytes | None, bool]:
    """Return ``(encoded image bytes, was_cache_hit)``.

    Hit: the cached file is read and returned untouched. Miss: the image is
    downloaded through :func:`scryfall.download_image_bytes` (which retries), then
    written atomically before being returned. With the cache disabled every call
    is a miss that is not written. ``url`` may be ``None`` only when a hit is
    expected (e.g. replaying a dataset offline); a miss without a URL yields
    ``(None, False)`` rather than raising, so callers can treat it like a decode
    failure.
    """
    if enabled():
        path = cache_path(scryfall_id, face, fmt)
        if path.is_file():
            data = path.read_bytes()
            if data:  # a zero-byte file is a failed write from a pre-atomic era
                return data, True
    if not url:
        return None, False
    data = scryfall.download_image_bytes(url)
    if enabled():
        _write_atomic(cache_path(scryfall_id, face, fmt), data)
    return data, False


def get_bytes(
    scryfall_id: str, face: str, url: str | None, *, fmt: str | None = None
) -> bytes | None:
    """Encoded image bytes for one card face, from the cache or Scryfall."""
    return fetch_bytes(scryfall_id, face, url, fmt=fmt)[0]


def fetch_image(
    scryfall_id: str, face: str, url: str | None, *, fmt: str | None = None
) -> tuple[np.ndarray | None, bool]:
    """Return ``(decoded BGR image or None, was_cache_hit)``.

    A cached file that fails to decode is treated as corrupt: it is deleted and
    the image downloaded once more (reported as a miss). If the fresh download
    does not decode either the image is genuinely bad and ``None`` is returned —
    the same signal the old direct download gave for an undecodable payload.
    """
    data, hit = fetch_bytes(scryfall_id, face, url, fmt=fmt)
    image = scryfall.decode_image(data) if data is not None else None
    if image is None and hit:
        # Corrupt cache entry: drop it and re-fetch exactly once (no loop — if
        # Scryfall itself serves junk we do not want to hammer it).
        with contextlib.suppress(OSError):
            cache_path(scryfall_id, face, fmt).unlink()
        data, hit = fetch_bytes(scryfall_id, face, url, fmt=fmt)
        image = scryfall.decode_image(data) if data is not None else None
    return image, hit


def get_image(
    scryfall_id: str, face: str, url: str | None, *, fmt: str | None = None
) -> np.ndarray | None:
    """Decoded BGR image for one card face, from the cache or Scryfall."""
    return fetch_image(scryfall_id, face, url, fmt=fmt)[0]


def iter_cached(fmt: str | None = None) -> Iterator[tuple[str, str, Path]]:
    """Yield ``(scryfall_id, face, path)`` for every cached image of one format.

    Sorted by path so consumers that sample from the cache (the synthetic
    composite generator) are reproducible for a given cache content. Files that
    do not follow the ``<sid>_<face>.jpg`` naming (stray temp files, manual
    copies) are skipped. Yields nothing when the cache is disabled or absent.
    """
    if not enabled():
        return
    fmt = fmt or config.SCRYFALL_IMAGE_FORMAT
    base = _root() / fmt
    if not base.is_dir():
        return
    for path in sorted(base.glob(f"*/*{_SUFFIX}")):
        stem = path.name[: -len(_SUFFIX)]
        sid, sep, face = stem.rpartition("_")
        if not sep or not sid or not face:
            continue
        yield sid, face, path


def stats() -> dict[str, int]:
    """``{"files": n, "bytes": total}`` over every format in the cache."""
    files = 0
    size = 0
    if enabled() and _root().is_dir():
        for path in _root().rglob(f"*{_SUFFIX}"):
            if path.is_file():
                files += 1
                size += path.stat().st_size
    return {"files": files, "bytes": size}


def prune(older_than_days: float, *, dry_run: bool = False) -> tuple[int, int]:
    """Delete cached images whose mtime is older than ``older_than_days``.

    Returns ``(files removed, bytes freed)``. Empty prefix directories are left in
    place (cheap, and they will be reused). mtime is set at download time and the
    cache never rewrites a hit, so "older than" means "downloaded before".
    """
    cutoff = time.time() - older_than_days * 86400.0
    removed = 0
    freed = 0
    if not enabled() or not _root().is_dir():
        return removed, freed
    for path in _root().rglob(f"*{_SUFFIX}"):
        if not path.is_file():
            continue
        st = path.stat()
        if st.st_mtime < cutoff:
            removed += 1
            freed += st.st_size
            if not dry_run:
                path.unlink()
    return removed, freed


def warm(set_codes: list[str], *, fmt: str | None = None, log=print) -> tuple[int, int]:
    """Download every face image of the given sets into the cache (no indexing).

    Returns ``(downloaded, already cached)``. Uses the same card/face enumeration
    as the index builder so what gets cached is exactly what a later
    ``build_index`` of those sets will read. The Scryfall throttle is honoured on
    misses only — replaying a warm run over a full cache takes seconds.
    """
    # Imported here: build_index imports this module, so a top-level import would
    # be circular. Only the face-resolution helper is needed.
    from .build_index import _faces_for

    fmt = fmt or config.SCRYFALL_IMAGE_FORMAT
    downloaded = 0
    hits = 0
    for code in set_codes:
        n_set = 0
        for card in scryfall.iter_set_cards(code):
            for face_label, image_url, _name in _faces_for(card, fmt=fmt):
                if not image_url:
                    continue
                try:
                    _data, hit = fetch_bytes(card["id"], face_label, image_url, fmt=fmt)
                except Exception as err:  # keep going; one bad image shouldn't stop a set
                    log(f"  ! {code} {card.get('name')!r} {face_label}: {err}")
                    continue
                n_set += 1
                if hit:
                    hits += 1
                else:
                    downloaded += 1
                    time.sleep(config.SCRYFALL_REQUEST_DELAY)
        log(f"{code}: {n_set} faces ({downloaded} downloaded so far, {hits} already cached)")
    return downloaded, hits


def _human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024  # type: ignore[assignment]
    return f"{n} B"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.image_cache", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("stats", help="count cached files and bytes")
    p_prune = sub.add_parser("prune", help="delete files downloaded more than N days ago")
    p_prune.add_argument("--older-than", type=float, required=True, metavar="DAYS")
    p_prune.add_argument("--dry-run", action="store_true", help="report only, delete nothing")
    p_warm = sub.add_parser("warm", help="download every face image of the given sets")
    p_warm.add_argument("--set", nargs="+", required=True, metavar="CODE", dest="sets")
    p_warm.add_argument("--fmt", default=None, help="Scryfall image size (default: config)")
    args = parser.parse_args(argv)

    if not enabled():
        print("Image cache is disabled (IMAGE_CACHE_DIR is empty).")
        return 1 if args.command != "stats" else 0
    print(f"Image cache: {_root()}")

    if args.command == "stats":
        s = stats()
        print(f"  files: {s['files']}\n  bytes: {s['bytes']} ({_human(s['bytes'])})")
        return 0
    if args.command == "prune":
        removed, freed = prune(args.older_than, dry_run=args.dry_run)
        verb = "would remove" if args.dry_run else "removed"
        print(f"  {verb} {removed} file(s), {_human(freed)}")
        return 0
    downloaded, hits = warm(args.sets, fmt=args.fmt)
    print(f"Done: {downloaded} downloaded, {hits} already cached.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

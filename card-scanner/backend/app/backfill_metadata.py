"""
Fill the text-metadata columns of an existing index without downloading images.

The OCR stage needs, per indexed face, the normalised name keys, collector-number
forms, layout, language, illustration id, etc. (see :mod:`app.metadata`). New sets
get them at index time, but the ~115k faces indexed before those columns existed
would otherwise need a full multi-hour re-index just to re-fetch text. Instead this
CLI streams Scryfall's *Default Cards* bulk export — one ~80 MB gzipped JSONL file
covering the same "English, or the printed language when that is all there is"
population the index was built from — and derives the columns from it::

    python -m app.backfill_metadata                 # download + backfill everything
    python -m app.backfill_metadata --only-missing  # rows with no name_key yet
    python -m app.backfill_metadata --file default-cards.jsonl.gz --dry-run

Zero image traffic; one bulk download; a few minutes end to end. When it finishes it
bumps ``index_meta('metadata_version')``, which changes the matcher's cache
signature so the running API reloads its name tables without a restart.
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from . import config, index_db, metadata

_BULK_MANIFEST = "https://api.scryfall.com/bulk-data/default-cards"


def _open_bulk(path: str | None):
    """Yield parsed card objects from a local file or the live bulk export.

    Streams line by line through ``gzip`` so the whole export is never in memory.
    """
    headers = {"User-Agent": config.SCRYFALL_USER_AGENT, "Accept": "application/json"}
    if path:
        raw = open(path, "rb")  # noqa: SIM115 - closed by the `with raw:` below
    else:
        manifest = json.load(
            urllib.request.urlopen(
                urllib.request.Request(_BULK_MANIFEST, headers=headers), timeout=60
            )
        )
        url = manifest.get("jsonl_download_uri") or manifest["download_uri"]
        print(
            f"bulk export: {url} ({manifest.get('compressed_size', '?')} bytes, updated {manifest.get('updated_at')})"
        )
        raw = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120)
    with raw:
        stream = gzip.GzipFile(fileobj=raw) if (path or "").endswith(".gz") or not path else raw
        text = io.TextIOWrapper(stream, encoding="utf-8")
        first = text.read(1)
        if first == "[":
            # Legacy JSON-array export: fall back to a full parse (memory-hungry but rare).
            yield from json.loads(first + text.read())
            return
        buf = first + text.readline()
        while buf:
            line = buf.strip().rstrip(",")
            if line and line not in ("]", "["):
                yield json.loads(line)
            buf = text.readline()


def _row_map(conn, only_missing: bool) -> dict[tuple[str, str], int]:
    """``{(scryfall_id, face): row id}`` for the rows to (re)fill."""
    where = "WHERE name_key IS NULL" if only_missing else ""
    rows = conn.execute(f"SELECT id, scryfall_id, face FROM cards {where}").fetchall()
    return {(r["scryfall_id"], r["face"]): r["id"] for r in rows}


def backfill(path: str | None, *, only_missing: bool, dry_run: bool, batch: int = 2000) -> int:
    """Run the backfill; returns the number of rows updated."""
    index_db.init_db()
    with index_db.connection() as conn:
        targets = _row_map(conn, only_missing)
        print(f"{len(targets)} face rows to fill ({'missing only' if only_missing else 'all'})")
        if not targets:
            return 0

        updated = seen = 0
        pending: list[tuple[int, dict]] = []
        t0 = time.perf_counter()

        def flush() -> None:
            nonlocal updated
            if not pending or dry_run:
                pending.clear()
                return
            for row_id, meta in pending:
                index_db.update_metadata(conn, row_id, meta)
            conn.commit()
            updated += len(pending)
            pending.clear()

        for card in _open_bulk(path):
            seen += 1
            sid = card.get("id")
            for face_label in ("single", "front", "back"):
                row_id = targets.pop((sid, face_label), None)
                if row_id is None:
                    continue
                meta = metadata.face_metadata(card, face_label)
                meta["meta_version"] = index_db.METADATA_VERSION
                pending.append((row_id, meta))
            if len(pending) >= batch:
                flush()
                print(
                    f"  ...{seen} cards read, {updated} rows updated, {len(targets)} still to match",
                    flush=True,
                )
            if not targets:
                break
        flush()

        if not dry_run:
            index_db.set_meta(conn, "metadata_version", str(index_db.METADATA_VERSION))
            conn.commit()
        filled, total = index_db.metadata_coverage(conn)
        print(
            f"done in {time.perf_counter() - t0:.0f}s: {seen} bulk cards read, {updated} rows "
            f"{'would be ' if dry_run else ''}updated, {len(targets)} index rows not found in the "
            f"export; coverage now {filled}/{total}"
        )
        if targets:
            sample = list(targets)[:5]
            print(f"  unmatched examples: {sample}")
    return updated


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.backfill_metadata", description=__doc__)
    parser.add_argument(
        "--file",
        help="local default-cards export (.jsonl.gz / .jsonl / .json) instead of downloading",
    )
    parser.add_argument("--only-missing", action="store_true", help="only rows without a name_key")
    parser.add_argument("--dry-run", action="store_true", help="parse and report, write nothing")
    parser.add_argument("--batch", type=int, default=2000, help="rows per commit")
    args = parser.parse_args(argv)
    if args.file and not Path(args.file).exists():
        print(f"no such file: {args.file}", file=sys.stderr)
        return 1
    backfill(args.file, only_missing=args.only_missing, dry_run=args.dry_run, batch=args.batch)
    return 0


if __name__ == "__main__":
    try:
        code = main(sys.argv[1:])
    finally:
        index_db.close_pool()  # avoid the unclosed-pool finalisation warning on exit
    sys.exit(code)

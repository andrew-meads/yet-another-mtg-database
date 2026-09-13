"""
Build the identification index from Scryfall, one set at a time.

Usage (inside the backend container)::

    python -m app.build_index tla tle
    python -m app.build_index <set_code> [<set_code> ...]

For each card in a set we download the chosen image size, compute its Stage-1
pHash and Stage-2 feature descriptors, and upsert a row per face. Re-running is
idempotent (rows are keyed by scryfall_id + face). The per-set unit makes it
trivial to expand coverage later — eventually to all English sets.

Scryfall etiquette: we send a descriptive User-Agent and throttle requests
(`SCRYFALL_REQUEST_DELAY`). Card images are served from Scryfall's CDN and go
through the on-disk image cache (`app.image_cache`), so a re-index of a set whose
images are already cached does no image traffic at all — the throttle sleep is
applied on cache misses only.
"""

from __future__ import annotations

import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

from . import config, features, hashing, image_cache, index_db, metadata, scryfall

# The HTTP helpers used to live here; they moved to app.scryfall so the harnesses
# and the image cache share them. These thin wrappers keep older call sites
# working. They delegate at call time (rather than binding the function objects
# at import) so a monkeypatched `scryfall.*` is honoured no matter when this
# module was first imported.
_API = scryfall.API


def _get_json(url: str) -> dict:
    return scryfall.get_json(url)


def _download_image(url: str):
    return scryfall.download_image(url)


def _iter_set_cards(set_code: str):
    return scryfall.iter_set_cards(set_code)


def _get_sets() -> list[dict]:
    return scryfall.get_sets()


def _get_set(code: str) -> dict | None:
    return scryfall.get_set(code)


def _faces_for(card: dict, fmt: str | None = None):
    """Resolve the image source(s) for a card.

    Returns a list of ``(face_label, image_url, face_name)``. A top-level
    ``image_uris`` means a single image (covers normal cards *and* split/adventure
    cards, which render both halves on one face). Only true double-faced cards
    (transform / modal DFC) lack a top-level image and expose per-face
    ``image_uris`` — those become one entry per face. ``fmt`` is the Scryfall
    image size (default ``config.SCRYFALL_IMAGE_FORMAT``); the cache warmer passes
    it explicitly so it can pre-fetch a size other than the one being indexed.
    """
    fmt = fmt or config.SCRYFALL_IMAGE_FORMAT
    if card.get("image_uris"):
        return [("single", card["image_uris"].get(fmt), card.get("name"))]

    faces = []
    for i, face in enumerate(card.get("card_faces", [])):
        image_uris = face.get("image_uris")
        if image_uris:
            faces.append(("front" if i == 0 else "back", image_uris.get(fmt), face.get("name")))
    return faces


class LiveStatus:
    """A sticky, in-place multi-line terminal status display.

    On a TTY, each :meth:`render` overwrites the previous block in place using an
    ANSI "cursor previous line" move (`ESC[<n>F`) plus per-line clears (`ESC[2K`),
    so the same lines are rewritten instead of scrolling. When stdout is NOT a TTY
    (piped, redirected to a file, or `docker compose exec -d`/`-T`), it disables
    itself so callers fall back to plain logging and no escape codes leak.
    """

    def __init__(self) -> None:
        self.enabled = sys.stdout.isatty()
        self._lines = 0

    def render(self, lines: list[str]) -> None:
        """Draw/redraw the status block in place."""
        if not self.enabled:
            return
        out = []
        if self._lines:
            # Jump back up to the first line of the previously drawn block.
            out.append(f"\033[{self._lines}F")
        for line in lines:
            out.append("\033[2K" + line + "\n")  # clear the whole line, then write
        sys.stdout.write("".join(out))
        sys.stdout.flush()
        self._lines = len(lines)

    def finish(self) -> None:
        """Stop tracking the block so later normal prints appear below it."""
        self._lines = 0


class ErrorLog:
    """Counts per-card indexing errors and appends full details to a file.

    The running ``count`` feeds the live status block; the file gets a timestamped
    entry per failure (with traceback when available) so problems can be examined
    after a long build. The file is opened lazily on the first error and appended
    to (a session header delimits each run), so successful builds leave no file.
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.count = 0
        self._fh = None

    def _ensure_open(self):
        if self._fh is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._fh = open(self.path, "a")  # noqa: SIM115 - stays open across records; see close()
            self._fh.write(
                f"\n===== index build run {datetime.now().isoformat(timespec='seconds')} =====\n"
            )

    def record(self, context: str, exc: BaseException | None = None) -> None:
        """Tally an error and write its context (+ traceback if any) to the file."""
        self.count += 1
        self._ensure_open()
        self._fh.write(f"[{datetime.now().isoformat(timespec='seconds')}] {context}\n")
        if exc is not None:
            # Called from within an `except` block, so format_exc() has context.
            self._fh.write(traceback.format_exc())
        self._fh.write("\n")
        self._fh.flush()

    def close(self) -> None:
        if self._fh is not None:
            self._fh.close()
            self._fh = None


def index_set(
    conn,
    set_code: str,
    *,
    status: LiveStatus | None = None,
    errors: ErrorLog | None = None,
    set_pos: int = 1,
    set_total: int = 1,
    set_name: str | None = None,
    size_before: int = 0,
    card_count: int | None = None,
) -> int:
    """Index every face of every card in a set. Returns the number of faces added.

    When ``status`` is an enabled :class:`LiveStatus`, a 4-line block (set / card /
    index size / error tally) is redrawn in place per card; otherwise no per-card
    output is emitted. Per-card failures are tallied and detailed in ``errors``.
    ``size_before`` is the index row count at the start of this set, so the live
    "Index size" line can grow without a per-card ``COUNT(*)`` round-trip.
    Records the set as done so bulk builds can resume.
    """
    set_name = set_name or set_code
    cards = list(_iter_set_cards(set_code))
    total = len(cards)
    indexed = 0

    def _render(card_pos: int, card_name: str) -> None:
        if not (status and status.enabled):
            return
        n_errors = errors.count if errors else 0
        error_line = f"Errors: {n_errors}"
        if errors and n_errors:
            error_line += f"  (details: {errors.path})"
        status.render(
            [
                f"[{set_pos}/{set_total}] Current set: {set_name}",
                f"[{card_pos}/{total}] Current card: {card_name}",
                f"Index size: {size_before + indexed} rows",
                error_line,
            ]
        )

    _render(0, "...")  # show the new set immediately, before downloads start

    for card_pos, card in enumerate(cards, start=1):
        for face_label, image_url, face_name in _faces_for(card):
            if not image_url:
                continue
            context = (
                f"set={set_code} card={card.get('name')!r} "
                f"scryfall_id={card.get('id')} face={face_label} url={image_url}"
            )
            cache_hit = False
            try:
                # Cached images skip the network entirely, so the Scryfall throttle
                # below only applies when something was actually downloaded.
                image, cache_hit = image_cache.fetch_image(card["id"], face_label, image_url)
                if image is None:
                    if errors is not None:
                        errors.record(context + " — image decode returned None")
                    continue
                phash = hashing.compute_phash(image)
                keypoints, descriptors = features.compute_descriptors(image)
                kp_blob, desc_blob = features.serialize_features(keypoints, descriptors)

                index_db.upsert_card(
                    conn,
                    scryfall_id=card["id"],
                    oracle_id=card.get("oracle_id"),
                    name=face_name or card.get("name", "Unknown"),
                    set_code=card.get("set"),
                    collector_number=card.get("collector_number"),
                    face=face_label,
                    image_url=image_url,
                    scryfall_uri=card.get("scryfall_uri"),
                    phash=phash,
                    kp_pts=kp_blob,
                    descriptors=desc_blob,
                    # Text metadata for the OCR stage (same derivation the backfill uses),
                    # so freshly indexed sets never need a backfill.
                    metadata={
                        **metadata.face_metadata(card, face_label),
                        "meta_version": index_db.METADATA_VERSION,
                    },
                )
                indexed += 1
            except Exception as err:  # keep going on a single bad card
                if errors is not None:
                    errors.record(context, exc=err)
                # In live mode the tally shows in the block; otherwise log briefly.
                if not (status and status.enabled):
                    print(f"  ! error on {card.get('name')}: {err}", file=sys.stderr)
            if not cache_hit:
                time.sleep(config.SCRYFALL_REQUEST_DELAY)

        _render(card_pos, card.get("name", "?"))

    conn.commit()
    index_db.mark_set_done(conn, set_code, indexed, card_count)
    conn.commit()
    return indexed


def _eligible_english_sets(sets: list[dict]):
    """Filter Scryfall sets to the ones worth indexing for a collection.

    Drops the excluded ``set_type``s (config.EXCLUDED_SET_TYPES) and empty sets,
    and reports how many of each excluded type were skipped.
    """
    excluded_counts: dict[str, int] = {}
    eligible = []
    for s in sets:
        set_type = s.get("set_type")
        if set_type in config.EXCLUDED_SET_TYPES:
            excluded_counts[set_type] = excluded_counts.get(set_type, 0) + 1
            continue
        if not s.get("card_count"):
            continue
        eligible.append(s)
    return eligible, excluded_counts


def index_all_english(conn, force: bool = False, list_only: bool = False) -> int:
    """Index every eligible English set, skipping excluded types and done sets.

    English is Scryfall's default search language, so no extra filter is needed.
    Card images are downloaded per set; ``indexed_sets`` lets a re-run skip sets
    already completed (use ``force=True`` to re-index them). ``list_only=True``
    previews what would be indexed without downloading anything.
    """
    sets = _get_sets()
    eligible, excluded_counts = _eligible_english_sets(sets)

    excluded_detail = (
        ", ".join(f"{k}={v}" for k, v in sorted(excluded_counts.items())) or "(none matched)"
    )
    print(f"Scryfall has {len(sets)} sets.")
    print(f"Excluded types {sorted(config.EXCLUDED_SET_TYPES)}: {excluded_detail}")
    print(f"{len(eligible)} eligible sets.")

    if list_only:
        for s in eligible:
            tag = "[done]" if index_db.is_set_done(conn, s["code"]) else "      "
            print(
                f"  {tag} {s['code']:<6} {s.get('set_type', '?'):<14} "
                f"{s.get('card_count', 0):>5}  {s.get('name')}"
            )
        return 0

    status = LiveStatus()
    errlog = ErrorLog(config.INDEX_ERROR_LOG)
    total = 0
    for i, s in enumerate(eligible, start=1):
        code = s["code"]
        current_count = s.get("card_count")
        done = index_db.is_set_done(conn, code)
        stored_count = index_db.set_card_count(conn, code) if done else None

        if done and not force:
            if stored_count is None:
                # Legacy set indexed before card_count tracking: assume complete
                # and just record the count (no re-download); future runs can then
                # change-detect against it.
                index_db.backfill_card_count(conn, code, current_count)
                conn.commit()
                if not status.enabled:
                    print(
                        f"[{i}/{len(eligible)}] skip '{code}' ({s.get('name')}) — "
                        f"recorded card_count {current_count} (legacy)"
                    )
                continue
            if stored_count == current_count:
                # Already indexed and unchanged → skip.
                if not status.enabled:
                    print(
                        f"[{i}/{len(eligible)}] skip '{code}' ({s.get('name')}) — "
                        f"unchanged ({current_count} cards)"
                    )
                continue

        # Re-indexing an already-done set (card_count changed, e.g. a set still
        # being released, or --force): wipe its stale rows first. The delete is
        # left uncommitted so it lands in the same transaction the rebuild
        # commits — readers keep seeing the old rows until the swap is complete.
        if done:
            removed = index_db.delete_set(conn, code)
            if not status.enabled:
                print(
                    f"[{i}/{len(eligible)}] re-indexing '{code}' (card_count "
                    f"{stored_count} -> {current_count}, cleared {removed} old rows)"
                )
        elif not status.enabled:
            print(
                f"[{i}/{len(eligible)}] '{code}' ({s.get('name')}, "
                f"{s.get('set_type')}, {current_count} cards) ..."
            )

        added = index_set(
            conn,
            code,
            status=status,
            errors=errlog,
            set_pos=i,
            set_total=len(eligible),
            set_name=s.get("name"),
            size_before=index_db.count(conn),
            card_count=current_count,
        )
        if not status.enabled:
            print(f"    added {added} faces (index now {index_db.count(conn)} rows)")
        total += added

    status.finish()
    errlog.close()
    print(
        f"\nAll-English build done. {total} faces added this run; index holds "
        f"{index_db.count(conn)} rows."
    )
    if errlog.count:
        print(f"{errlog.count} card(s) errored — details in {errlog.path}")
    return total


_USAGE = """usage:
  python -m app.build_index <set_code> [<set_code> ...]   index specific sets
  python -m app.build_index --all [--force]               index all English sets
                                                          (skips excluded set types
                                                           and already-done sets)
  python -m app.build_index --all --list                  preview eligible sets only
"""


def main(argv: list[str]) -> int:
    flags = {a for a in argv if a.startswith("--")}
    positional = [a for a in argv if not a.startswith("--")]
    want_all = "--all" in flags or (positional[:1] == ["all"])
    force = "--force" in flags
    list_only = "--list" in flags

    if not argv or (not want_all and not positional):
        print(_USAGE)
        return 1

    index_db.init_db()
    with index_db.connection() as conn:
        if want_all:
            index_all_english(conn, force=force, list_only=list_only)
        else:
            status = LiveStatus()
            errlog = ErrorLog(config.INDEX_ERROR_LOG)
            total = 0
            for i, code in enumerate(positional, start=1):
                meta = _get_set(code)  # for the set's card_count (and display name)
                current_count = meta.get("card_count") if meta else None
                if not status.enabled:
                    print(f"Indexing set '{code}' ...")
                added = index_set(
                    conn,
                    code,
                    status=status,
                    errors=errlog,
                    set_pos=i,
                    set_total=len(positional),
                    set_name=(meta or {}).get("name", code),
                    size_before=index_db.count(conn),
                    card_count=current_count,
                )
                if not status.enabled:
                    print(f"  indexed {added} faces from '{code}'")
                total += added
            status.finish()
            errlog.close()
            print(f"\nDone. {total} faces this run; index now holds {index_db.count(conn)} rows.")
            if errlog.count:
                print(f"{errlog.count} card(s) errored — details in {errlog.path}")
    return 0


if __name__ == "__main__":
    try:
        code = main(sys.argv[1:])
    finally:
        index_db.close_pool()  # avoid the unclosed-pool finalisation warning on exit
    raise SystemExit(code)

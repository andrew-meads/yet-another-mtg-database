# Seeding the database & user scripts

Scripts live in `src/scripts/`, run via `tsx`, and load env through `dotenv/config`
(reading `MONGO_DB_URI`). Place bulk JSON files in `bulk-data/` (gitignored).

## `init-db` (`src/scripts/init-db.ts`)

Streams a large Scryfall "oracle/all cards" bulk file into the `cards` collection. It is a
`commander` CLI:

```bash
npm run init-db -- -f bulk-data/oracle-cards-XXXX.jsonl.gz   # import from file (gz/plain, lines/array)
npm run init-db -- --data-url <url>                           # download + import
npm run init-db -- --bulk-type oracle_cards                   # resolve today's URL via /bulk-data/<type>, then download + import
npm run init-db -- -f <file> --clear                          # wipe cards first
```

- Exactly one of `--file` / `--data-url` / `--bulk-type` may be given; with none,
  `ALL_CARDS_FILE` is used.
- `--bulk-type` calls `${SCRYFALL_API_BASE_URL}/bulk-data/<type>` (`oracle_cards`,
  `default_cards`, `all_cards`, …) and follows `jsonl_download_uri` (falling back to
  `download_uri`), since the timestamped file names change daily.

### Bulk file format & streaming parse (`src/lib/server/scryfallBulkStream.ts`)

**Scryfall's bulk downloads are now gzipped JSON Lines** (`*.jsonl.gz`, one card object per
line, served as `application/gzip` with no `Content-Encoding` — so `fetch` does not
decompress them; the bulk-data API exposes only `jsonl_download_uri`, the old array-layout
`download_uri` is gone).

**`createCardStream(readable)`** is the entry point — it **sniffs** the first bytes
(`peekBytes`, which reads until a non-whitespace byte and `unshift`s everything back) to
gunzip on the `1f 8b` magic (`isGzip`) and to pick the layout (`detectBulkLayout`: leading
`[` → legacy top-level array via stream-json's `createCardArrayStream`; otherwise JSON Lines
via the self-contained `JsonLinesTransform` / `createCardLinesStream`, which tolerates
CRLF/blank lines, handles multi-byte characters split across chunks, and errors with the
offending line number) — so extensions and content types are irrelevant and all four
combinations (plain/gzipped × array/lines) work. Every source emits `{ key, value }` card
items.

stream-json v3 is ESM-only, ships its own types, and subpath imports carry the `.js`
suffix (e.g. `stream-json/streamers/stream-array.js`); its own JSONL helper is deprecated
(a thin re-export of stream-chain), hence the hand-rolled transform. Unit-tested in
`src/lib/server/__tests__/scryfallBulkStream.test.ts`.

### Prices on import & re-import semantics

Each bulk-data card object carries Scryfall's `prices` object, which is kept **on the card
document** (`MtgCard.prices`, declared in the schema) — the import normalizes it with
`extractPrices` and stamps `prices_updated_at = now` on every batch item before insert, so
freshly imported cards count as a 24h-fresh price refresh (see [pricing.md](pricing.md)).

On a **re-import without `--clear`** the Mongo driver throws a `BulkWriteError` when any
document of an unordered `insertMany` fails (duplicate ids) even though the rest were
inserted — `insertCards` catches that error, takes the inserted count from it, and falls
through to its per-card recovery, which queries what landed, **overwrites the prices of
the cards that already existed** from the batch via `applyCardPrices`
(`src/lib/server/cardPrices.ts`; pure op builder `buildPriceUpdates`, one non-upserting
`updateOne` by `id`, later duplicates win), and retries only the missing ids. So a
re-import is idempotent for card data (documents are only inserted when missing; use
`--clear` to replace them) and a refresh for prices.

## `backfill-release-dates` (`src/scripts/backfill-release-dates.ts`)

Cards carry a `released_at` ("YYYY-MM-DD") field used for release-date sorting. New
imports get it from the bulk JSON; a database imported before the field existed must be
upgraded once with `npm run backfill-release-dates`, which fetches Scryfall's `GET /sets`
and stamps each card with its set's release date (idempotent; `--force` re-stamps
everything; pure helper `extractSetDates` in `src/lib/scryfallSets.ts`). Un-backfilled
cards sort before dated ones ascending, so set sort degrades to the old set-code order
until the script runs.

## `whitelist-user`

Sign-in is **deny-by-default**: only emails present in the `users` collection can log in
(see [auth.md](auth.md)). Add one with:

```bash
npm run whitelist-user -- user@example.com
```

## Schema notes for older databases

- `tcgplayer_etched_id` was added to the card schema later, so cards imported before it
  lack etched TCGplayer prices.
- Cards imported before prices were kept lack `prices_updated_at` and therefore count as
  stale (no backfill needed; the on-demand refresh fills them in).
- The former `cardprices` collection was removed; an old database may still carry that
  orphaned collection, which can simply be dropped.

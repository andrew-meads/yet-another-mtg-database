# Environment & external APIs

Copy `.env.example` to `.env`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `MONGO_DB_URI` | MongoDB connection string (default `mongodb://127.0.0.1:27017/...`). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `AUTH_SECRET` / `NEXTAUTH_URL` | NextAuth Google OAuth. |
| `AUTH_DEV_LOGIN` | `"true"` outside production registers the dev-only Credentials provider (see [auth.md](auth.md)). |
| `SETTINGS_ENCRYPTION_KEY` | Optional 64-hex-char key; AES-256-GCM-encrypts secrets stored in user settings (currently the per-user AI API key) via `src/lib/server/secretBox.ts`. Without it secrets are stored plaintext with a one-time warning. |
| `SCANNER_BASE_URL` | The card-scanner backend (`card-scanner/`) that `/api/scan` and `/api/scan/crops/[file]` proxy to (default `http://localhost:8000`; the production compose sets `http://card-scanner:8000`). |
| `ALL_CARDS_FILE` | Default bulk import path for `init-db`. |
| `SCRYFALL_API_BASE_URL` | Scryfall API base (default `https://api.scryfall.com`); used by the card-refresh, set-icon, and card-price routes. |
| `TCGCSV_BASE_URL` | TCGCSV mirror of TCGplayer prices (default `https://tcgcsv.com`); free, key-less. |
| `MANAPOOL_API_BASE_URL` | Mana Pool price feed (default `https://manapool.com`); free, key-less. |
| `EXCHANGE_RATE_API_BASE_URL` | Currency exchange-rate API for price conversion (default `https://api.frankfurter.dev/v1`); free, no key. |
| `ACADEMY_RUINS_API_BASE_URL` | Comprehensive-Rules API used by the AI advisor's `lookupRule` tool (default `https://api.academyruins.com`); free, no key. |
| `COMMANDER_SPELLBOOK_API_BASE_URL` | Combo database used by the advisor's `findCombos` tool (default `https://backend.commanderspellbook.com`); free, no key. |
| `AI_CHAT_DEBUG` | `"true"` dumps every AI tool's full result JSON to the server console (one-line summaries with timing are always logged). |

## Scryfall API etiquette (`src/lib/scryfall.ts`)

Scryfall requires a custom `User-Agent` and an `Accept` header on every API request, and a
max of 10 requests/second — **all Scryfall `fetch`es go through `scryfallFetch` /
`SCRYFALL_HEADERS`**, which attaches the headers and rate-limits starts to <= 10/s via an
in-process serialized queue (relies on the server being a long-lived singleton; not
coordinated across instances).

The Python scanner in `card-scanner/` is a separate process with its own Scryfall client
(`SCRYFALL_USER_AGENT`, `SCRYFALL_REQUEST_DELAY` — 100 ms between requests by default) for
building its image index. Its rate limit is not coordinated with the app's, so avoid
running a full `build_index --all` at the same time as a Scryfall-heavy app task. Card images
it downloads (index builds, the evaluation harness, the synthetic-data generator) are cached
on disk under `IMAGE_CACHE_DIR` (`data/scryfall-cache/` via the compose bind mount), so only
cache misses hit Scryfall and a full re-index never re-downloads. The one-off metadata
backfill (`python -m app.backfill_metadata`) streams Scryfall's bulk `default_cards` export
instead of paging the API.

## Scryfall image CDN & the default User-Agent (`src/instrumentation.ts`)

Scryfall's image CDN (`cards.scryfall.io`) **also** rejects requests sent with an
HTTP-library-default `User-Agent` (`400 { subcode: "generic_user_agent" }`). Next's
`<Image>` optimizer fetches those images server-side via the global `fetch` (undici), and
Next exposes no way to set a `User-Agent` on that request.

So **`src/instrumentation.ts`** (the Next server-boot hook) calls
`installDefaultUserAgentFetch()` from **`src/lib/server/defaultUserAgent.ts`**, which
attaches a default `User-Agent` (the same one as `SCRYFALL_HEADERS`) **only when the caller
didn't set one** — so `scryfallFetch`, AI SDK calls, and any explicit-UA caller pass
through untouched. Without this, optimized Scryfall card images 400 with
`"url" parameter is valid but upstream response is invalid`.

The install is **not** a plain `globalThis.fetch = wrapper` assignment: Next itself
re-assigns `globalThis.fetch` with its own instrumentation wrapper (in dev mode *after*
`instrumentation.ts` has run, and again on recompiles), which would silently drop the
wrapper — dev then 400s on every uncached image while production works. Instead `fetch` is
redefined as a get/set accessor whose setter transparently re-wraps whatever is assigned
(the wrapper is a `Proxy`, so Next's patch markers stay visible and it doesn't re-patch in
a loop). `instrumentation.ts` only runs `register()` at server **boot**, so a running dev
server must be restarted to pick up changes to it.

## Set icons (`src/app/api/sets/[code]/svg/route.ts`)

Lazily caches Scryfall set-symbol SVGs into the `setsvgs` collection on first request,
then serves from DB with long-lived cache headers.

## Remote image hosts

Remote images are restricted to specific hosts in `next.config.ts` (`cards.scryfall.io`,
`errors.scryfall.com`, `lh3.googleusercontent.com`) — add new hosts there.

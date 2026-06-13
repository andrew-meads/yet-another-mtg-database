# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A personal Magic: The Gathering card database and collection manager. Next.js 16 (App Router, React 19) frontend + API routes, backed by MongoDB via Mongoose. Card data originates from Scryfall bulk JSON. Features include Scryfall-style search, collection/deck/wishlist management, drag-and-drop card organization, and camera-based card scanning (proxied to an external card-scanner backend).

## Commands

```bash
npm run dev              # Start dev server (http://localhost:3000)
npm run build            # Production build
npm run start            # Run production build
npm run lint             # ESLint (eslint-config-next)

npm run init-db          # Import Scryfall bulk card data into MongoDB
npm run whitelist-user   # Whitelist a user by email (see Auth below)
```

There is **no test suite** in this repo.

### Local development infrastructure

`docker-compose-dev.yml` spins up only the backing services — MongoDB (host port `27017`), the card-scanner Postgres DB, and the external `card-scanner` backend (host port `8000`) — **without** the Next.js app. Use it for developing the app locally with `npm run dev` (which connects to Mongo via `MONGO_DB_URI` in `.env`, default `mongodb://127.0.0.1:27017/...`):

```bash
docker compose -f docker-compose-dev.yml up -d   # start databases + scanner
npm run dev                                       # run the Next.js app on the host
```

`docker-compose.yml` is the full production stack (app + Mongo + scanner behind Caddy); `docker-compose-dev.yml` is the same minus the app service and reverse proxy.

### Seeding the database

`init-db` (`src/scripts/init-db.ts`) streams a large Scryfall "oracle/all cards" JSON file into the `cards` collection. It is a `commander` CLI:

```bash
npm run init-db -- -f bulk-data/oracle-cards-XXXX.json   # import from file
npm run init-db -- --data-url <url>                       # download + import
npm run init-db -- -f <file> --clear                      # wipe cards first
```

Place bulk JSON files in `bulk-data/` (gitignored). Scripts run via `tsx` and load env through `dotenv/config`, reading `MONGO_DB_URI`.

### Whitelisting a user

Sign-in is **deny-by-default**: only emails present in the `users` collection can log in (see Auth). Add one with:

```bash
npm run whitelist-user -- user@example.com
```

## Environment

Copy `.env.example` to `.env`. Key vars: `MONGO_DB_URI`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `AUTH_SECRET` / `NEXTAUTH_URL` (NextAuth Google OAuth), `SCANNER_BASE_URL` (external card-scanner backend the `/api/scan` route proxies to — defaults to `http://localhost:8000`), `ALL_CARDS_FILE` (default bulk import path).

## Architecture

### Data layer (`src/db/`, `src/types/`)
- **`src/db/mongoose.ts`** — `connectDB()` caches the connection on `global.mongoose` to survive Next.js hot-reload. **Every API route must `await connectDB()` before touching a model.**
- **`src/db/schema.ts`** — all Mongoose schemas/models, guarded with the `mongoose.models.X || mongoose.model(...)` pattern (required so re-imports during hot-reload don't throw). Models: `Card`, `CardCollectionModel`, `UserModel`, `TagModel`, `SetSvgModel`.
- Plain TS interfaces in `src/types/` are the source of truth for document shapes; schemas are typed against them (`new Schema<MtgCard>(...)`). The `MtgCard` shape mirrors Scryfall's card JSON.
- A `CardCollection` has a `collectionType` of `"collection" | "wishlist" | "deck"` and embeds its cards as an array of `{ cardId, quantity, notes, tags }`. Cards are referenced by Scryfall string `id`, **not** by Mongo `_id`.

### Search engine (`src/lib/search/`)
Parses Scryfall-like query strings into MongoDB query objects. Entry point: `parseSearchQuery(queryString)` (re-exported from `index.ts`). Pipeline:
1. **`parser.ts`** — `tokenizeQuery` (handles quotes, parentheses) then `parseTerm` (splits `key:value`, comparison operators `>= <= > < =`, and `-` negation).
2. **`queryBuilder.ts`** — recursive-descent `parseExpression` builds boolean structure: implicit AND between terms, explicit `or`, parenthesized groups, and `$nor` for negation. Bare terms (no `key:`) become a name/`flavor_name` regex search.
3. **`config.ts` + `operators/`** — each operator (color, type, oracle, manavalue, set, rarity, etc.) is a `SearchOperatorConfig` with `aliases`, `buildQuery(value, operator)`, and optional `validate`. **To add a search operator: create a file in `operators/`, export it from `operators/index.ts`, and register it in `searchOperators` in `config.ts`.**

Sorting is separate (`src/lib/sortConfig.ts`): some sort fields require a MongoDB aggregation pipeline (`useAggregation` + `buildAggregationSort`). `GET /api/cards` switches between `.find().sort()` and an aggregation pipeline, also using `$lookup` against `cardcollections` for the `owned=true` filter.

### Auth (`src/auth.ts`)
NextAuth (v4) with Google provider, **JWT session strategy (no DB session store)**. `src/app/api/auth/[...nextauth]/route.ts` just re-exports the handler.
- The `signIn` callback enforces the whitelist: rejects any email not found in `users`. On first successful sign-in it auto-creates a "Main Collection" for the user.
- The DB `_id` is threaded through `jwt` → `session` callbacks and exposed as `session.user._id` (typed via module augmentation in `auth.ts`).
- **API routes are auth-gated by `src/proxy.ts`** — this is the Next.js 16 middleware (the file was renamed from `middleware.ts` to `proxy.ts` in Next 16). Its `getToken()` check returns `401 { error: "Unauthorized" }`, and its `matcher` (`"/api/((?!auth).*)"`) protects every `/api/*` route except `/api/auth/*`. Routes that need the user id additionally call `getServerSession(authOptions)` and read `session!.user._id` (trusting the middleware).
- Pages are also gated server-side: e.g. `(with-app-bar)/(main)/layout.tsx` calls `getServerSession` and redirects to `/login` when absent.

### Routing (`src/app/`)
App Router with route groups (folders in parentheses don't affect URL paths):
- `(with-app-bar)/` — adds the global `AppBar`. `(main)/` nested group adds auth gate + `MainWorkspace`, containing `/search` and `/my-cards`.
- `/scan` + `/scan/results` — camera capture and recognition results (client-side, uses `ScanContext`).
- API routes under `app/api/`: `cards`, `collections`, `sets`, `tags`, `scan`, `auth`.

### Card scanning (`src/app/api/scan/`, `src/app/scan/`)
`POST /api/scan` (`src/app/api/scan/route.ts`) is a thin **auth-guarded proxy** to the external card-scanner backend (`ghcr.io/andrew-meads/card-scanner-backend`, defined in the compose files at port 8000). It validates the multipart `image` field, forwards it to `${SCANNER_BASE_URL}/api/scan` (default `http://localhost:8000`), and passes the scanner's JSON back verbatim — each detected card's de-skewed crop plus a pre-ranked list of candidate Scryfall printings (`{ count, cards: [{ id, url, width, height, matches }], debugUrl }`, typed in `src/types/ScanResult.ts`). Returns `502` if the scanner is unreachable. Touches no Mongo model.

The client flow lives in `src/app/scan/`:
- `/scan` (`page.tsx`) — camera capture (full-frame, multi-card; front/back `facingMode` toggle; best-effort tap-to-focus) **or** uploading an existing image; both POST the blob via `usePostImageForScan` → `/api/scan`, store the result in `ScanContext`, and route to `/scan/results`.
- `/scan/results` (`page.tsx` + `src/components/scan/ScannedCardItem.tsx`) — per detected card, shows the crop and a horizontally-scrolling, single-select strip of candidate printings (best match pre-selected), a quantity stepper, and an Add button that adds the chosen printing **by its `scryfallId`** to the active collection (`useUpdateCollectionCards`, action `"add"`) without leaving the page. Closing does `history.go(-2)` (past `/scan`).
- Crops come back as scanner-relative `url`s (`/cards/<file>.jpg`) and are served through the auth-proxied **`GET /api/scan/crops/[file]`** route. Render them with a plain `<img>` — `next/image` can't optimize this route because the optimizer fetches server-side without the user's auth cookie (→ 401). Candidate images are `cards.scryfall.io` URLs (allowed in `next.config.ts`), so `next/image` is fine there.

### Set icons (`src/app/api/sets/[code]/svg/route.ts`)
Lazily caches Scryfall set-symbol SVGs into the `setsvgs` collection on first request, then serves from DB with long-lived cache headers.

### Client state & data fetching
- **TanStack Query** for all server state. Hooks live in `src/hooks/react-query/` (e.g. `useInfiniteCardsSearch`, `useRetrieveCollectionDetails`). Provider in `src/context/QueryProvider.tsx`; all providers composed in `src/context/Providers.tsx`.
- **React Context** for cross-component UI state: `CardSelectionContext`, `OpenCollectionsContext`, `ScanContext`.
- **react-dnd** (HTML5 backend) for drag-and-drop; sources/targets in `src/hooks/drag-drop/`.
- UI is **shadcn/ui** (Radix primitives) in `src/components/ui/` + **Tailwind CSS v4** (config in `globals.css` / `postcss.config.mjs`, no `tailwind.config`). `mana-font` renders mana symbols.

## Conventions
- Import alias `@/*` → `src/*`.
- Prettier: no tabs, double quotes, no trailing commas, 100-col width.
- Card identity across collections is the Scryfall string `id`, never the Mongo `_id`.
- Remote images are restricted to specific hosts in `next.config.ts` (`cards.scryfall.io`, `errors.scryfall.com`, `lh3.googleusercontent.com`) — add new hosts there.

## Deployment
Multi-stage `Dockerfile` (Node 22) + `docker-compose.yml` running the app, MongoDB, and the external card-scanner stack behind a Caddy reverse proxy (labels in compose). For local development use `docker-compose-dev.yml` instead (backing services only — see Commands).

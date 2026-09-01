# Yet Another MTG Database

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-Radix-black)
![TanStack Query](https://img.shields.io/badge/TanStack_Query-v5-FF4154?logo=reactquery&logoColor=white)
![NextAuth](https://img.shields.io/badge/NextAuth-v4-purple?logo=auth0&logoColor=white)
![Vitest](https://img.shields.io/badge/Tested_with-Vitest-6E9F18?logo=vitest&logoColor=white)
![Playwright](https://img.shields.io/badge/E2E-Playwright-2EAD33?logo=playwright&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

A personal **Magic: The Gathering** card database and collection manager. Search the
entire Scryfall card pool with a Scryfall-style query language, organize your
collection / decks / wishlist with drag-and-drop, and add cards straight from your
phone's camera with image-based card scanning.

Built with Next.js 16 (App Router + API routes) and MongoDB.

## Features

- **Scryfall-style search** — a full query parser supporting `key:value` operators
  (color, type, oracle text, mana value, set, rarity, …), comparison operators
  (`>= <= > < =`), negation, `or`, and parenthesized groups, plus configurable sorting.
  The same search bar works on both the card-search page and inside a collection
  (collection results are filtered server-side by the same engine), with an
  **Advanced Search** dialog that builds the query string from form fields and a
  **Search help** panel (the `?` button) that docks beside the workspace —
  reflowing the page instead of overlaying it, so the reference stays visible
  while you type. It documents every operator with click-to-add examples that
  append to your query.
- **Collections, decks & wishlists** — group cards into named collections of type
  `collection`, `deck`, or `wishlist`, each card carrying a quantity, notes, and tags.
- **Drag-and-drop organization** — move and copy cards between collections with
  react-dnd.
- **Active collection & active deck** — mark one collection and one deck as "active"
  from the app bar (right-click an open collection/deck → **Make active**, or tap its
  star on mobile). The two are independent, and they become the default target for
  quick-add actions. On the card-search page, select a card and press `+` (or `=`) to
  add it to the active collection, or `d` to add it to the active deck — the deck copy
  is created in your active collection and placed in the deck's first column, exactly
  like dragging the search result onto the deck. Press `shift+d` to add the card to the
  active deck as an ephemeral (deck-only) copy instead, with no collection needed.
- **Deck card counts** — the deck view shows a running total of cards next to the deck's
  name, and next to each section's name. The My Cards landing page also lists each
  collection and deck with its description and total card count.
- **Basic lands in decks** — add basic lands (Plains/Island/Swamp/Mountain/Forest)
  straight into a deck from a per-section "Add land" picker, without first adding them
  to a collection. These "ephemeral" copies live only in the deck and are removed from
  existence when taken out of it; they can only be reordered within their own deck.
- **Archive & fill decks** — **Archive** dismantles a deck while keeping the decklist:
  every real card returns to its collection and is replaced in place by an ephemeral
  placeholder of the same printing. **Fill** rebuilds it: a dialog matches the deck's
  placeholders against real copies in your active collection (same printing prioritized,
  other printings of the same card allowed) and swaps the ones you pick back in,
  preserving every card's exact position. Each suggested copy shows a small card
  image (click to flip multi-faced cards) so you can see exactly which printing it is.
- **Camera card scanning** — capture one or more physical cards (or upload an image)
  and get de-skewed crops plus ranked candidate Scryfall printings to add with one tap.
- **Set-symbol rendering** — Scryfall set-symbol SVGs are lazily cached and served from
  the database; mana symbols rendered via `mana-font`.
- **Card pricing** — up-to-date USD prices for a card or a list of cards, pulled from
  Scryfall and cached for 24h, plus conversion into a chosen currency using a live
  exchange rate (Frankfurter).
- **Hover card preview** — hovering a row in search results or a collection shows a card
  image preview, configurable on the **Settings page** (`/settings`, gear icon in the app
  bar): toggle it on/off, pick a size (small/normal/large), and set the show delay
  (500–2000 ms). Preferences save to the browser's local storage and apply immediately.
- **Google sign-in** — NextAuth Google OAuth with a deny-by-default email whitelist.

## Tech stack

- **Framework:** Next.js 16 (App Router, API routes), React 19, TypeScript
- **Database:** MongoDB via Mongoose
- **Auth:** NextAuth v4 (Google provider, JWT sessions)
- **Server state:** TanStack Query
- **UI:** shadcn/ui (Radix primitives) + Tailwind CSS v4, `mana-font`, `lucide-react`
- **Drag & drop:** react-dnd (HTML5 backend)
- **Card data:** Scryfall bulk JSON
- **Card scanner:** external [`card-scanner-backend`](https://github.com/andrew-meads)
  service (`ghcr.io/andrew-meads/card-scanner-backend`), proxied by `POST /api/scan`

## Prerequisites

- **Node.js 22+**
- **Docker** (to run MongoDB and the card-scanner backend locally)
- A **Google OAuth client** (Client ID + Secret) for sign-in
- A **Scryfall bulk data file** (e.g. "Oracle Cards" or "All Cards" JSON) to seed the
  database — download from [scryfall.com/docs/api/bulk-data](https://scryfall.com/docs/api/bulk-data)
  and place it in `bulk-data/` (gitignored)

## Getting started (local development)

```bash
# 1. Clone & install
git clone https://github.com/andrew-meads/yet-another-mtg-database.git
cd yet-another-mtg-database
npm install

# 2. Configure environment
cp .env.example .env
# then edit .env — see Environment variables below

# 3. Start backing services (MongoDB + card-scanner backend)
docker compose -f docker-compose-dev.yml up -d

# 4. Seed the database from a Scryfall bulk file
npm run init-db -- -f bulk-data/oracle-cards-XXXX.json

# 5. Whitelist your Google account so you're allowed to sign in
npm run whitelist-user -- you@example.com

# 6. Run the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`docker-compose-dev.yml` runs only the backing services (MongoDB on `27017`, the
card-scanner Postgres DB, and the scanner backend on `8000`) — **not** the Next.js app,
which you run on the host with `npm run dev`.

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description |
| --- | --- |
| `MONGO_DB_URI` | MongoDB connection string (default `mongodb://127.0.0.1:27017/yet-another-mtg-database`) |
| `ALL_CARDS_FILE` | Default path to the Scryfall bulk JSON used by `init-db` |
| `SCRYFALL_API_BASE_URL` | Base URL of the Scryfall API (default `https://api.scryfall.com`), used to fetch individual cards, set icons, and card prices on demand |
| `EXCHANGE_RATE_API_BASE_URL` | Base URL of the currency exchange-rate API used to convert USD card prices (default `https://api.frankfurter.dev/v1` — free, no API key) |
| `AUTH_DEV_LOGIN` | Dev only: set to `"true"` to add a "Continue as dev user" button to the login page (see [Authentication](#authentication)). Ignored when `NODE_ENV=production`. Requires `AUTH_SECRET` and `NEXTAUTH_URL`, but not the Google OAuth vars |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `AUTH_SECRET` | Random secret used to sign NextAuth JWTs |
| `NEXTAUTH_URL` | Public base URL of the app (e.g. `http://localhost:3000` in dev) |
| `SCANNER_BASE_URL` | Base URL of the external card-scanner backend (default `http://localhost:8000`) |

## npm scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server at http://localhost:3000 |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Run ESLint (`eslint-config-next`) |
| `npm run init-db` | Import Scryfall bulk card data into MongoDB |
| `npm run whitelist-user` | Whitelist a user by email so they can sign in |
| `npm run backfill-release-dates` | One-off upgrade: stamp `released_at` on existing cards from Scryfall's set list (new imports include it natively) |

### Seeding the database

`init-db` streams a large Scryfall bulk JSON file into the `cards` collection:

```bash
npm run init-db -- -f bulk-data/oracle-cards-XXXX.json   # import from a local file
npm run init-db -- --data-url <url>                       # download + import
npm run init-db -- -f <file> --clear                      # wipe cards first
```

## Authentication

Sign-in is **deny-by-default**: only emails present in the `users` collection can log
in. Add one with `npm run whitelist-user -- you@example.com`. On a user's first
successful sign-in, a "Main Collection" is created for them automatically. API routes
are gated by the Next.js middleware (`src/proxy.ts`).

### Dev login (`AUTH_DEV_LOGIN`)

For local development without Google OAuth, run `npm run dev:devlogin` (or set
`AUTH_DEV_LOGIN=true`). This registers a dev-only NextAuth Credentials provider and the
login page shows a **"Continue as dev user"** button that signs in as a fixed local user
(`_id 000000000000000000000001`). That user and an active "Main Collection" are
provisioned automatically on sign-in. Unlike the old no-auth mode, this is a **real
NextAuth session** — a normal JWT cookie, the middleware auth gate stays fully active,
and sign-out works as usual — so `AUTH_SECRET` and `NEXTAUTH_URL`
(`http://localhost:3000` in dev) are still required, but the Google OAuth vars are not.
The provider is registered only when `NODE_ENV !== "production"`, so it can never appear
in a production build; deployments (see `docker-compose.yml`) use real Google login and
need real OAuth values in the host's `.env`.

## Card scanning

`POST /api/scan` is a thin, auth-guarded proxy to the external card-scanner backend. It
forwards an uploaded image to `${SCANNER_BASE_URL}/api/scan` and returns the scanner's
result verbatim — each detected card's de-skewed crop plus a ranked list of candidate
Scryfall printings. Run the scanner via the dev/prod compose files (it ships as
`ghcr.io/andrew-meads/card-scanner-backend` and depends on its own Postgres database).

## Project structure

```
src/
├── app/          # Next.js App Router: pages, route groups, and /api routes
├── components/   # React components (UI, search page, my-cards page, scan, dnd)
├── context/      # React context providers + TanStack Query provider
├── db/           # Mongoose connection (mongoose.ts) and schemas (schema.ts)
├── hooks/        # TanStack Query hooks and react-dnd drag/drop hooks
├── lib/          # Search query parser/builder, sort config, utilities
├── scripts/      # CLI scripts (init-db, whitelist-user) run via tsx
├── types/        # TypeScript interfaces — source of truth for document shapes
└── instrumentation.ts  # Server boot hook: gives the global fetch a custom User-Agent
                        # so Next's image optimizer can load Scryfall card images
```

See [`CLAUDE.md`](CLAUDE.md) for a deeper tour of the architecture (search engine, auth,
data layer, and scanning internals).

## Deployment

`docker-compose.yml` defines the full production stack — the Next.js app, MongoDB, and
the card-scanner backend (with its Postgres DB) — behind a Caddy reverse proxy:

```bash
docker compose up -d --build
```

The app image is built from the multi-stage `Dockerfile` (Node 22).

## License

Licensed under the [Apache License 2.0](LICENSE).

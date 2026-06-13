# Yet Another MTG Database

A personal **Magic: The Gathering** card database and collection manager. Search the
entire Scryfall card pool with a Scryfall-style query language, organize your
collection / decks / wishlist with drag-and-drop, and add cards straight from your
phone's camera with image-based card scanning.

Built with Next.js 16 (App Router + API routes) and MongoDB.

## Features

- **Scryfall-style search** — a full query parser supporting `key:value` operators
  (color, type, oracle text, mana value, set, rarity, …), comparison operators
  (`>= <= > < =`), negation, `or`, and parenthesized groups, plus configurable sorting.
- **Collections, decks & wishlists** — group cards into named collections of type
  `collection`, `deck`, or `wishlist`, each card carrying a quantity, notes, and tags.
- **Drag-and-drop organization** — move and copy cards between collections with
  react-dnd.
- **Camera card scanning** — capture one or more physical cards (or upload an image)
  and get de-skewed crops plus ranked candidate Scryfall printings to add with one tap.
- **Set-symbol rendering** — Scryfall set-symbol SVGs are lazily cached and served from
  the database; mana symbols rendered via `mana-font`.
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
| `SCRYFALL_API_BASE_URL` | Base URL of the Scryfall API (default `https://api.scryfall.com`), used to fetch individual cards and set icons on demand |
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
└── types/        # TypeScript interfaces — source of truth for document shapes
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

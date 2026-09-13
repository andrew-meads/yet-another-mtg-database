# CLAUDE.md

Guidance for Claude Code when working in this repository. This file is the high-level map
and the cross-cutting rules. Feature-level reference lives in [`docs/`](docs/) — read the
relevant doc **when you start work on that area**, not up front.

## Overview

A personal Magic: The Gathering card database and collection manager. Next.js 16 (App
Router, React 19) frontend + API routes, backed by MongoDB via Mongoose. Card data
originates from Scryfall bulk JSON. Features: Scryfall-style search, collections and decks
with drag-and-drop, per-copy finish/condition and pricing, an AI deck advisor, and
camera-based card scanning (proxied to the Python card-scanner backend in `card-scanner/`).

## Planning & implementation checklist

Any non-trivial plan must include steps for:

1. **Tests** — add or update unit, integration, component, and/or e2e tests as appropriate
   for the change, even if the task description doesn't mention it (see
   [docs/testing.md](docs/testing.md) for the layers).
2. **Lint** — run `npm run lint` at the end and fix all errors and warnings before
   considering the task done (plus `npm run scanner:lint` and `npm run scanner:test` when
   touching `card-scanner/`).
3. **Documentation** — keep `README.md`, this file, and the relevant `docs/*.md` up to
   date. Feature detail belongs in `docs/`; this file only gets the map, conventions, and
   invariants that apply across the codebase.

## Commands

```bash
npm run dev              # Start dev server (http://localhost:3000)
npm run dev:devlogin     # Dev server with the passwordless dev-login provider (no Google vars needed)
npm run build            # Production build
npm run start            # Run production build
npm run lint             # ESLint (eslint-config-next)

npm run init-db          # Import Scryfall bulk card data into MongoDB (see docs/database-seeding.md)
npm run whitelist-user   # Whitelist a user by email (sign-in is deny-by-default)
npm run backfill-release-dates # Stamp released_at on cards imported before the field existed

npm test                 # Run all Vitest projects (unit + integration + jsdom)
npm run test:unit        # Pure-logic unit tests
npm run test:integration # API route + server-helper tests (mongodb-memory-server)
npm run test:components  # React component/hook/context/page tests (jsdom + RTL)
npm run test:coverage    # Vitest with v8 coverage
npm run test:e2e         # Playwright E2E (run `npm run test:e2e:install` once first)

npm run scanner:venv     # One-off: Python venv for the card-scanner (uv; picks up card-scanner/backend/.python-version)
npm run scanner:test     # Card-scanner pytest suite (no Postgres/network/models needed)
npm run scanner:lint     # Card-scanner ruff check + format check
npm run scanner:eval     # Card-scanner real-photo accuracy harness (needs the scanner Postgres)
```

Run a single Vitest project with `vitest run --project <unit|integration|jsdom>`.

### Local development

`docker-compose-dev.yml` starts only the backing services (MongoDB on `27017`, the
card-scanner backend on `8000`) so the app runs on the host:

```bash
docker compose -f docker-compose-dev.yml up -d
npm run dev
```

Copy `.env.example` to `.env` first. The full variable list, with defaults, is in
[docs/external-apis.md](docs/external-apis.md).

## Architecture map

| Area | Where | Doc |
| --- | --- | --- |
| Mongoose connection + schemas, domain model (cards, physical copies, collections, decks) | `src/db/`, `src/types/`, `src/lib/server/` | [docs/data-model.md](docs/data-model.md) |
| Scryfall-style query parser → Mongo queries, sorting, `GET /api/cards`, search UI | `src/lib/search/`, `src/lib/sortConfig.ts`, `src/components/search/` | [docs/search-engine.md](docs/search-engine.md) |
| NextAuth (Google + dev login), whitelist, API middleware | `src/auth.ts`, `src/proxy.ts` | [docs/auth.md](docs/auth.md) |
| App Router route groups, pages, 404, easter egg, icons | `src/app/` | [docs/routing.md](docs/routing.md) |
| TanStack Query hooks, contexts, selected-card panel, drag-and-drop, shortcuts | `src/hooks/`, `src/context/`, `src/components/` | [docs/client-state.md](docs/client-state.md) |
| Prices on cards, price sources, per-copy prices, currency | `src/lib/server/cardPrices.ts`, `src/lib/server/priceSources/`, `src/lib/pricing.ts`, `src/components/pricing/` | [docs/pricing.md](docs/pricing.md) |
| Server-side user settings, AI provider, NL search, deck-advisor chat + tools | `src/lib/server/userSettings.ts`, `src/lib/ai/`, `src/app/api/ai/` | [docs/user-settings-and-ai.md](docs/user-settings-and-ai.md), `AI_ROADMAP.md` |
| Deck export (txt/csv/xlsx/pdf) | `src/lib/deckExport.ts`, `src/lib/server/deckExport*.ts` | [docs/deck-export.md](docs/deck-export.md) |
| Card scanning: proxy + camera/results UI, and the Python scanner backend itself | `src/app/api/scan/`, `src/app/scan/`, `src/components/scan/`, `card-scanner/` | [docs/card-scanning.md](docs/card-scanning.md), [card-scanner/README.md](card-scanner/README.md) |
| Bulk import, release-date backfill, whitelist script | `src/scripts/`, `src/lib/server/scryfallBulkStream.ts` | [docs/database-seeding.md](docs/database-seeding.md) |
| Env vars, Scryfall etiquette, User-Agent instrumentation, set icons | `src/lib/scryfall.ts`, `src/instrumentation.ts` | [docs/external-apis.md](docs/external-apis.md) |
| Test projects, E2E harness, scanner pytest suite | `vitest.config.ts`, `tests/`, `e2e/`, `card-scanner/backend/tests/` | [docs/testing.md](docs/testing.md) |
| Docker, Caddy, compression | `Dockerfile`, `docker-compose*.yml` | [docs/deployment.md](docs/deployment.md) |

## Invariants & gotchas

These bite across features. The docs explain the why.

- **Every API route must `await connectDB()`** before touching a model.
- **Restart `next dev` after editing any Mongoose schema.** Models are registered once per
  process (`mongoose.models.X || mongoose.model(...)`), so a hot-reloaded route will accept a
  new field while the old schema silently drops it on write.
- **Card identity is the Scryfall string `id`, never the Mongo `_id`.** The `CardData`
  model is pinned to the Mongo collection `cards`.
- **`PhysicalCard.collectionId` / `deckId` back-refs are the source of truth for
  membership.** A copy is in at most one collection and at most one deck; `collectionId ===
  null` means an *ephemeral* copy that only exists inside its deck and is deleted when it
  leaves. "Quantity" is display-only grouping; no document stores a count.
- **No multi-document transactions.** Write the `PhysicalCard` back-ref first, then fix up
  the deck's ordered arrays; `GET /api/decks/[id]?details=true` reconciles the two.
- **Finish/condition are optional and absent means the default** (`nonfoil` / `NM`). Read
  through `effectiveFinish` / `effectiveCondition`, persist through `sparseAttributes`.
- **Detail responses are slim and deduplicated** (`{ entries, cardData }`). When a component
  reads a new card field, extend both `SLIM_CARD_PROJECTION` and `SlimMtgCard`.
- **All `/api/*` routes except `/api/auth/*` are gated by the `src/proxy.ts` middleware**
  (Next 16's renamed `middleware.ts`). Routes that need the user call `getAuthSession()`.
- **All Scryfall calls go through `scryfallFetch`** (required headers, ≤10 req/s). Never
  call Scryfall with a bare `fetch`. (The Python scanner in `card-scanner/` has its own
  throttled Scryfall client for index builds; this rule is about the Next app.)
- **The owned-filter `$lookup` must stay in `localField`/`foreignField` form** and
  `physicalcards.cardId` must stay indexed, or broad owned searches take minutes.
- **Adding a search operator** = new file in `src/lib/search/operators/`, export from
  `operators/index.ts`, register in `config.ts`, and document in
  `src/components/search/searchDocs.tsx` (a unit test cross-checks the docs, and the AI
  prompt is generated from them).
- **`card-scanner/` is a separate Python service, not part of the Next build.** It is
  excluded from `npm run lint`, `tsconfig.json`, Prettier, and the app's Docker context. It
  has its own pytest suite, ruff config and accuracy harnesses (`npm run scanner:test`,
  `scanner:lint`, `scanner:eval`; CI `.github/workflows/card-scanner.yml`). Any detection or
  identification change must be measured with `app.evaluate_photos` against the labelled
  `card-scanner/test-images/test-images.json` (the user-authored manifest is the source of
  truth; tooling only appends machine fields) and the committed baselines in
  `card-scanner/benchmarks/`. It ships as the `ghcr.io/andrew-meads/card-scanner-backend`
  image the compose files pull (build with `docker build --target runtime`), and scans
  return no matches until its Postgres image index has been built.
- **`POST /api/scan` trusts only `scryfallId` from the scanner** and re-hydrates matches
  from the local `cards` collection; ids missing locally are dropped.
- **AI tools never write.** Deck changes go through the propose-and-confirm
  `proposeDeckChanges` tool and are applied only by the user in the UI. Every tool is
  owner-scoped and wraps server helpers directly (no HTTP self-calls).
- **Prices live on the card document**; `prices.source` absent means Scryfall. A price
  source outage must never be recorded as "no price".
- **Adding a price source** = registry entry in `src/lib/priceSources.ts` + adapter in
  `src/lib/server/priceSources/` + `PRICE_SOURCE_ADAPTERS` entry.
- **User preferences are server-synced through `useServerSetting`**; layout, search
  strings, the selected card, and the price toggle are deliberately localStorage-only.
- **SSR'd client UI whose first frame depends on `useLocalStorage` must guard with
  `useMounted()`** or React logs a hydration mismatch.
- `src/instrumentation.ts` only runs at server boot — restart the dev server to pick up
  changes to it.

## Conventions

- Import alias `@/*` → `src/*`.
- Prettier: no tabs, double quotes, no trailing commas, 100-col width.
- Plain TS interfaces in `src/types/` are the source of truth for document shapes;
  Mongoose schemas are typed against them.
- Server state through TanStack Query hooks in `src/hooks/react-query/`; cross-component
  UI state through the contexts in `src/context/`.
- Pure, client-safe helpers go in `src/lib/`; anything touching Mongo or server-only
  packages goes in `src/lib/server/`.
- Remote image hosts are allow-listed in `next.config.ts`; add new hosts there.
- Runtime request validation uses zod; schemas live next to the persistence helpers they
  protect.
- UI is shadcn/ui (Radix) in `src/components/ui/` + Tailwind CSS v4 (no `tailwind.config`).
- `package.json` `overrides` pins exceljs's transitive `uuid`; keep it until exceljs
  updates its own dependency.

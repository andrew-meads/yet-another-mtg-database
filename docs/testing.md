# Testing

The suite (Vitest 4 + Playwright) lives in three Vitest projects plus E2E. Config:
`vitest.config.ts`, `playwright.config.ts`. Run a single project with
`vitest run --project <name>`.

## Vitest projects

- **`unit`** (node) — pure functions: `src/lib/search/**`, `src/lib/sortConfig.ts`,
  `grouping.ts`, etc. Tests co-located in `__tests__/` next to the code.
- **`integration`** (node) — API route handlers and `src/lib/server/**` against an
  in-memory MongoDB (`mongodb-memory-server`); `getServerSession` is mocked. Files in
  `tests/integration/`; shared lifecycle/auth/seed helpers in `tests/integration/setup.ts`
  and `helpers.ts`. Runs single-fork with isolation off so one DB connection is shared.
  External HTTP (Scryfall, price sources, the OpenAI-compatible AI endpoint) is mocked
  with MSW or a URL-dispatching `mockFetch`.
- **`jsdom`** (jsdom) — components, hooks, contexts, and app pages (`src/app/**`) via
  Testing Library + MSW. Global mocks (`next/navigation`, `next/image`, `matchMedia`)
  in `vitest.setup.jsdom.ts`.

## E2E (`e2e/`, Playwright)

- Run `npm run test:e2e:install` once, then `npm run test:e2e`.
- Runs the app on port **3100** with its own `distDir` (`E2E_DIST_DIR`), so it never
  collides with a running dev server.
- `e2e/global-setup.ts` starts a fixed-port in-memory Mongo, seeds a user + an active
  "Main Collection" + cards (every seeded card is stamped with fresh prices so the price
  routes never call Scryfall; the two Grizzly Bears copies carry a per-copy price record),
  and mints a NextAuth session cookie. No production auth changes are involved.
- Specs that need particular entities open/pinned in the app bar seed them with
  `seedOpenEntities(page, refs)` from `e2e/openEntities.ts`, which writes the
  `openEntities` settings section through the real `PATCH /api/settings` route using the
  test's session cookie — **never** via the legacy `open-entity-ids` localStorage key,
  which the app migrates only once (the first spec to persist open entities would
  otherwise make every later localStorage seed a no-op).
- Specs that would hit external services intercept the route with `page.route`
  (e.g. `pricing.spec.ts` intercepts the price refresh route).

## Where feature tests live

Each feature doc under `docs/` ends with (or embeds) the list of its unit / integration /
jsdom / e2e test files. When you add a feature, add tests at every applicable layer and
list them in the relevant doc.

## Card-scanner (Python)

The Python scanner in `card-scanner/` is outside the Vitest projects, ESLint and
`tsconfig.json`, and has its own suite and tooling under `card-scanner/backend/`:

- **pytest** (`tests/`): pure helpers (geometry, hashing, name normalisation, collector-line
  parsing, fusion), synthetic-image detection (fake cards from `app.synth` on procedural
  backgrounds), the matcher against a fake in-memory index, the OCR engine with a fake
  backend, and the FastAPI app through Starlette's `TestClient`. No Postgres, network or
  ONNX models are needed; OCR is disabled in the test environment. Tests marked
  `integration` (a scratch Postgres database) run only with `SCANNER_INTEGRATION=1`,
  `network` ones only with `SCANNER_NETWORK=1`.
- **ruff** for lint + format (`pyproject.toml`).
- **Accuracy harnesses**: `app.evaluate` (synthetic self-retrieval of identification),
  `app.evaluate_photos` (the labelled real photos in `card-scanner/test-images/` and any
  directory holding a `test-images.json` manifest, e.g. `app.synth` output), with committed
  detection baselines in `card-scanner/benchmarks/` that gate CI.

Run on the host with `npm run scanner:venv` once, then `npm run scanner:test`,
`npm run scanner:lint`, `npm run scanner:eval`; or inside the exact runtime image with
`docker build --target test card-scanner/backend`. CI runs all of it in
`.github/workflows/card-scanner.yml`. See [card-scanner/README.md](../card-scanner/README.md).

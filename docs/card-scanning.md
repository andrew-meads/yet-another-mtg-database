# Card scanning (`src/app/api/scan/`, `src/app/scan/`, `card-scanner/`)

Camera-based card recognition. The image work is done by a Python service that lives in
[`card-scanner/`](../card-scanner/) — FastAPI + OpenCV + a PostgreSQL image index. Its
[README](../card-scanner/README.md) is the reference for detection, the two-stage matcher,
building the index, its config knobs, and its gotchas. The Next.js side is a thin
auth-guarded proxy plus the capture and results UI.

## The scanner backend (`card-scanner/`)

- Runs as two compose services in both compose files: `card-scanner` (host port `8000`)
  and `card-scanner-db` (Postgres 16 on the `card-scanner-pgdata` named volume). Compose
  pulls the prebuilt image `ghcr.io/andrew-meads/card-scanner-backend`; rebuild it from
  source with `docker build -t ghcr.io/andrew-meads/card-scanner-backend:latest card-scanner/backend`.
  De-skewed crops are bind-mounted to the repo-root `data/cards/` (gitignored).
- Its `POST /api/scan` detects and de-skews every card in a photo and, per crop, returns
  ranked candidates from a two-stage matcher (64-bit pHash shortlist → ORB + RANSAC
  re-rank). Shape: `{ count, cards: [{ id, url, width, height, matches: [{ scryfallId,
  name, set, collectorNumber, face, hammingDistance, featureScore, inliers, confident,
  imageUrl, scryfallUri }] }], debugUrl }` — `RawScanResponse` in `src/types/ScanResult.ts`.
- **Matches are empty until an index is built.** Run
  `docker compose -f docker-compose-dev.yml exec card-scanner python -m app.build_index --all`
  (or pass set codes) once; the index persists on the named volume and a running build is
  picked up by the API within ~5s without a restart.
- pHash identifies *artwork*, not printing: same-art reprints tie, so the scanner returns
  the top 5 for the user to pick. Reprint ambiguity is by design, not a bug.
- The scanner calls Scryfall itself with its own User-Agent and throttle. The
  `scryfallFetch` invariant in `CLAUDE.md` applies to the Next app only.
- It has no automated tests (`python -m app.evaluate` is the accuracy harness), and the
  folder is excluded from `npm run lint`, `tsconfig.json`, Prettier, and the app's Docker
  build context — it is a separate service, not part of the Next.js build.

## `POST /api/scan` (`src/app/api/scan/route.ts`)

Auth-guarded proxy. It validates the multipart `image` field and forwards it to
`${SCANNER_BASE_URL}/api/scan` (default `http://localhost:8000`; the production compose
sets `http://card-scanner:8000`).

**It is not a pure pass-through.** On a 200 it trusts only each match's `scryfallId` and
re-hydrates the matches from the local `cards` collection in one `$in` lookup
(`enrichScanResponse`), preserving the scanner's best-first order. Ids absent from our DB
are dropped, so a detected card can come back with `matches: []`. The client therefore
renders the same `MtgCard` data (name, set, rarity, collector number, images) as the rest
of the app — the enriched `ScanResponse` / `ScannedCard` shapes in `ScanResult.ts`. This is
the one scan route that touches Mongo (`connectDB()` + `CardData`). Non-2xx scanner
responses are forwarded verbatim; `502` if the scanner is unreachable.

`GET /api/scan/crops/[file]` proxies the crop images: the scanner serves them at
`/cards/<file>`, and the client passes the basename of a scanned card's `url`
(`cropProxyUrl` in `src/components/scan/scanShared.ts`). The filename is whitelisted
(`/^[\w-]+\.(jpe?g|png)$/i`), a scanner 404 stays 404 and anything else maps to 502, and
the response is `Cache-Control: private`.

## Client flow (`src/app/scan/`, `src/components/scan/`)

- `/scan` (`page.tsx`) — camera capture (full-frame, multi-card; a front/back `facingMode`
  toggle when the device has more than one camera; best-effort tap-to-focus) **or**
  uploading an existing image. Both POST the blob via `usePostImageForScan` → `/api/scan`,
  store the result in `ScanContext`, and route to `/scan/results`.
- `/scan/results` (`results/page.tsx`) — overview-first. Every detected card is a
  `ScannedCardTile` in a grid: the crop, a "Likely: <best match>" caption with set symbol
  and collector number (or "No match"), and an "Added ×N" badge once copies have been added.
  Tapping a tile opens `ScanDetailSheet` in a bottom sheet with Prev/Next paging through the
  batch, a zoomable crop thumbnail, a single-select grid of candidate printings (best match
  pre-selected, rendered with `SimpleCardArtView` from the local card data), a quantity
  stepper, and an Add button. Add calls `useCreatePhysicalCard` with `quantity` to create N
  physical cards **of the chosen printing's `id`** in the active collection without leaving
  the page. Per-card UI state (`CardUiState`: selected index, quantity, added count) lives
  on the page so it survives the sheet closing. Closing the page does `history.go(-2)`
  (past `/scan`).
- Crops render with a plain `<img>` — `next/image` can't optimize the crop proxy because
  the optimizer fetches server-side without the user's auth cookie (→ 401). Candidate
  images are ordinary `cards.scryfall.io` URLs from local card data (allowed in
  `next.config.ts`), so `next/image` is fine there.

Not yet finish-aware: the scan-results add flow always creates plain (non-foil, NM) copies.

## Tests

- `tests/integration/scan.test.ts` — the proxy route with the scanner `fetch` mocked:
  re-hydration in best-first order, dropping of ids unknown locally, non-200 pass-through,
  502 when unreachable, and the 401 for an unauthenticated request.
- `src/components/scan/__tests__/` — `ScannedCardTile` and `ScanDetailSheet` (jsdom).
- No E2E coverage; the scanner itself is validated with its `app.evaluate` harness and the
  sample photos in `card-scanner/test-images/`.

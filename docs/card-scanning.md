# Card scanning (`src/app/api/scan/`, `src/app/scan/`)

`POST /api/scan` (`src/app/api/scan/route.ts`) is a thin **auth-guarded proxy** to the
external card-scanner backend (`ghcr.io/andrew-meads/card-scanner-backend`, defined in the
compose files at port 8000). It validates the multipart `image` field, forwards it to
`${SCANNER_BASE_URL}/api/scan` (default `http://localhost:8000`), and passes the scanner's
JSON back verbatim — each detected card's de-skewed crop plus a pre-ranked list of
candidate Scryfall printings (`{ count, cards: [{ id, url, width, height, matches }], debugUrl }`,
typed in `src/types/ScanResult.ts`). Returns `502` if the scanner is unreachable. Touches
no Mongo model.

The client flow lives in `src/app/scan/`:

- `/scan` (`page.tsx`) — camera capture (full-frame, multi-card; front/back `facingMode`
  toggle; best-effort tap-to-focus) **or** uploading an existing image; both POST the blob
  via `usePostImageForScan` → `/api/scan`, store the result in `ScanContext`, and route to
  `/scan/results`.
- `/scan/results` (`page.tsx` + `src/components/scan/ScannedCardItem.tsx`) — per detected
  card, shows the crop and a horizontally-scrolling, single-select strip of candidate
  printings (best match pre-selected), a quantity stepper, and an Add button that adds the
  chosen printing **by its `scryfallId`** to the active collection (`useCreatePhysicalCard`
  with `quantity`, creating N physical cards) without leaving the page. Closing does
  `history.go(-2)` (past `/scan`).
- Crops come back as scanner-relative `url`s (`/cards/<file>.jpg`) and are served through
  the auth-proxied **`GET /api/scan/crops/[file]`** route. Render them with a plain
  `<img>` — `next/image` can't optimize this route because the optimizer fetches
  server-side without the user's auth cookie (→ 401). Candidate images are
  `cards.scryfall.io` URLs (allowed in `next.config.ts`), so `next/image` is fine there.

Not yet finish-aware: the scan-results add flow always creates plain (non-foil, NM) copies.

# MTG Card Scanner

The image-recognition backend behind the main app's **camera card scanning** feature. The
Next.js app's `POST /api/scan` route (see [`docs/card-scanning.md`](../docs/card-scanning.md))
forwards a photo here; this service **(Part 1)** finds each card in the photo and
perspective-corrects ("de-skews") it into a flat upright crop, then **(Part 2)** identifies
each crop against a local Scryfall image index and returns a ranked list of candidate
Scryfall IDs.

```
  Next.js app  ──POST /api/scan (proxy)──▶ FastAPI /api/scan ──OpenCV──▶ de-skewed crops
       ▲                                                                       │
       │                                                       two-stage matcher (pHash → ORB)
       │                                                                       │
       └──────────────── JSON: crop URLs + ranked Scryfall matches ────────────┘
```

**Part 2 identification is a two-stage matcher** (see [Identification](#identification-part-2)):
a fast perceptual-hash (pHash) shortlist for recall, then ORB local-feature + RANSAC homography
re-ranking for precision. The index is built per-set from Scryfall and lives in PostgreSQL.

This folder started life as a standalone prototype and still runs standalone (its own
`docker-compose.yml` and a small Vite harness), but in day-to-day use it is run by the main
repo's compose files and driven by the main app's own camera UI.

## Architecture

| Part | Stack | Where |
| --- | --- | --- |
| Backend | FastAPI + Uvicorn + OpenCV (headless) + Pillow + NumPy | `backend/` — Docker image |
| Database | PostgreSQL 16 (psycopg v3 + pool, raw SQL, no ORM) | `db` / `card-scanner-db` compose service |
| Dev harness | Vite + React 18 + TypeScript | `frontend/` — optional, standalone only |

The backend detects cards, saves each de-skewed crop under `CARDS_DIR`, and serves them at
`/cards/<file>.jpg`. It creates its two Postgres tables on startup (a DB hiccup at boot is
non-fatal; the matcher presents an empty index until Postgres is reachable). CORS is
wide-open (`allow_origins=["*"]`) — fine while the only exposure is on a private Docker
network behind the main app's auth-guarded proxy.

## Running

### As part of the main app (the normal way)

The main repo's `docker-compose-dev.yml` and `docker-compose.yml` both define the scanner
as two services — `card-scanner-db` (Postgres, on the `card-scanner-pgdata` named volume)
and `card-scanner` (the backend, host port `8000`, crops bind-mounted to the **repo-root**
`data/cards/`). They pull the prebuilt image `ghcr.io/andrew-meads/card-scanner-backend`.

```bash
# from the repo root
docker compose -f docker-compose-dev.yml up -d
curl http://localhost:8000/health              # -> {"status":"ok"}
curl http://localhost:8000/api/index/stats     # -> {"cards":0} until an index is built
```

The Next.js app reaches it via `SCANNER_BASE_URL` (default `http://localhost:8000`; the
production compose sets `http://card-scanner:8000`). **Scans return no matches until you
build an index** — see [Building the index](#building-the-index); with the main compose files
the service name is `card-scanner`, e.g.:

```bash
docker compose -f docker-compose-dev.yml exec card-scanner python -m app.build_index tla tle
```

To rebuild the image from this source instead of pulling it:

```bash
docker build -t ghcr.io/andrew-meads/card-scanner-backend:latest card-scanner/backend
# then `docker compose ... up -d card-scanner` (or push the tag to GHCR)
```

### Standalone (this folder's own compose + the Vite harness)

```bash
cd card-scanner
docker compose up --build            # services: db (Postgres) + backend, port 8000
```

Here the crops land in `card-scanner/data/cards/` and the service name is `backend`
(`docker compose exec backend python -m app.build_index …`).

The Vite harness is a minimal UI for exercising the backend directly (camera / file
capture, crops, ranked matches, and a toggle for the detection debug overlay). It is not
used by the main app.

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 — proxies /api and /cards to localhost:8000
npm run build    # tsc --noEmit && vite build
```

Open http://localhost:5173, click **Start camera** (or **Take / choose photo**), capture a
photo of cards on a contrasting surface, and the de-skewed cards appear below. Toggle
**Show detection overlay** to see what the detector locked onto.

> **Mobile note:** live camera (`getUserMedia`) needs a secure context — it works on
> `localhost` but not over `http://<lan-ip>`. On a phone, use **Take / choose photo**, which
> opens the native camera even over plain HTTP.

## API

### `POST /api/scan`

Multipart form, field `image` (a JPEG/PNG photo).

```bash
curl -F image=@photo.jpg http://localhost:8000/api/scan
# or against a bundled sample:
curl -F image=@"test-images/2026-06-11 09.29.13.jpg" http://localhost:8000/api/scan
```

```jsonc
{
  "count": 1,
  "cards": [
    {
      "id": "<batch>_0",
      "url": "/cards/<batch>_0.jpg",
      "width": 487,
      "height": 680,
      "matches": [                       // ranked best-first; [] if no index built
        {
          "scryfallId": "…", "name": "The Rise of Sozin",
          "set": "tla", "collectorNumber": "117", "face": "front",
          "hammingDistance": 0,          // Stage-1 pHash distance (lower = closer)
          "featureScore": 62, "inliers": 62,  // Stage-2 RANSAC inliers
          "confident": true,             // cleared MIN_INLIERS *and* CONFIDENT_MARGIN
          "imageUrl": "https://cards.scryfall.io/…",
          "scryfallUri": "https://scryfall.com/card/…"
        }
      ]
    }
  ],
  "debugUrl": "/cards/<batch>_debug.jpg"   // null if SAVE_DEBUG_OVERLAY=0
}
```

`face` is `"single"` for cards with one image (including split/adventure cards), or
`"front"`/`"back"` for true double-faced cards, which are indexed as one row per face.

The main app consumes **only `scryfallId`** from each match (it re-hydrates the rest from
its own `cards` collection) and serves the crop `url` through its authenticated
`GET /api/scan/crops/[file]` proxy. Errors: `400` for an empty or undecodable upload.

### `GET /cards/<file>.jpg`

Static serving of saved crops and debug overlays.

### `GET /api/index/stats`

`{ "cards": <number of indexed card faces> }`.

### `GET /health`

Liveness probe.

## How detection works (`backend/app/detection.py`)

1. **Decode (EXIF-aware)** with Pillow so phone-photo orientation is correct.
2. **Downscale** a working copy (long edge → `WORK_LONG_EDGE`, ~1000px) for fast,
   noise-tolerant edge finding; corners are mapped back onto the full-res original for
   sharpness.
3. **Edge map:** grayscale → Gaussian blur → Canny → dilate (close gaps).
4. **Contours:** keep convex 4-point polygons whose area is `MIN_AREA_RATIO`–`MAX_AREA_RATIO`
   of the frame (2–98%).
5. **De-skew:** order the 4 corners (TL/TR/BR/BL) and apply a four-point perspective
   transform sampled from the full-res original.
6. **Normalize:** rotate to portrait and resize to the standard 63:88 card ratio
   (~487×680, Scryfall "normal" size — convenient for Part-2 pHashing).

### Known limitations

- **Overlapping/touching cards** can merge into a single contour.
- **Low-contrast surfaces or strong glare** can cause missed cards.
- **Upright orientation** of the crop isn't resolved (it may be 180° off), but
  identification handles that via the pHash flip + rotation-invariant features.

## Identification (Part 2)

Each de-skewed crop is identified by a **two-stage matcher** against a **PostgreSQL** index of
Scryfall card images. Modeled on the YAMCR approach (see [Lineage](#lineage)), adapted to
Python/OpenCV.

1. **Stage 1 — pHash shortlist (recall)** `backend/app/hashing.py`
   64-bit DCT perceptual hash; rank the whole index by Hamming distance (vectorised
   NumPy popcount) and keep the top `SHORTLIST_K`. The query is hashed at 0° **and** 180°
   (cards may be upside-down) and the closer wins — only the query needs both orientations,
   the index stores one.
2. **Stage 2 — local-feature re-rank (precision)** `backend/app/features.py`
   ORB descriptors (histogram-equalized) matched with a Lowe ratio test, then a
   `cv2.findHomography(RANSAC)` **inlier count** picks the winner. ORB/SIFT are
   rotation-invariant, so Stage 2 needs no flip. `FEATURE_DETECTOR=sift` is selectable.

Stage 2 is what separates near-identical cards: e.g. a double-faced card whose two faces *tie* on
pHash is disambiguated by inlier count.

**Confidence is margin-aware** (`matcher._rank`). A match is `confident` only if it clears
`MIN_INLIERS` *and*, for the top match, beats the best-scoring *different* card (different
`oracle_id` — sibling reprints of the same card don't count as competitors) by
`CONFIDENT_MARGIN`. This is what cuts most false-confident calls.

**pHash identifies artwork, not printing.** Same-art reprints across sets are
indistinguishable by pHash, which is why the API returns the top-N (default 5) for a human
to confirm. "Any printing is fine" is a deliberate product decision — reprint ambiguity is
not a bug.

### Building the index

The index is built **per set** so coverage is easy to expand. Run the builder inside the
backend container (`card-scanner` with the main compose files, `backend` with this folder's):

```bash
# Specific sets:
docker compose -f docker-compose-dev.yml exec card-scanner python -m app.build_index tla tle

# All English sets (the whole game):
docker compose -f docker-compose-dev.yml exec card-scanner python -m app.build_index --all --list   # preview only
docker compose -f docker-compose-dev.yml exec card-scanner python -m app.build_index --all          # build (resumable)
docker compose -f docker-compose-dev.yml exec card-scanner python -m app.build_index --all --force  # re-index done sets

curl http://localhost:8000/api/index/stats        # -> {"cards": <count>}
```

`--all` iterates every Scryfall set, **skipping unwanted `set_type`s**
(`EXCLUDED_SET_TYPES`, default `minigame,token,vanguard,treasure_chest`) and English is Scryfall's
default search language. It is **resumable**: each finished set is recorded in `indexed_sets`
(with the Scryfall `card_count` at index time) and skipped on re-runs, so an interrupted full build
picks up where it left off. A full build downloads ~100k images over a long time — `--all --list`
first to see the ~800 eligible sets.

**Change detection (still-releasing sets).** On a re-run, a set is skipped only if its
`card_count` is **unchanged** since last indexed. If the count changed (e.g. a set that's still
being released has gained cards), that set's rows are **wiped and rebuilt** — atomically, in one
transaction, so the API keeps serving the old rows until the rebuild commits. Sets indexed before
`card_count` tracking existed are recorded once (not re-downloaded) on the next run. `--force`
rebuilds every set regardless.

**Progress display.** On an interactive terminal the builder shows a live, in-place 4-line block
that updates per card (no scrolling):

```
[137/811] Current set: Modern Horizons 3
[ 88/303] Current card: Necrodominance
Index size: 41897 rows
Errors: 3  (details: /data/cards/index_errors.log)
```

Per-card failures (download/decode/etc.) don't stop the build — they're tallied on the `Errors`
line and appended in full (context + traceback) to `INDEX_ERROR_LOG` (default
`<CARDS_DIR>/index_errors.log`, host-visible via the bind mount; created only if something
errors). Examine it after a long run to see exactly which cards failed and why.

When output is piped/redirected or the build is detached (no TTY), it automatically falls back to
plain one-line-per-set logging (errors to stderr + the same log file) — so nothing leaks ANSI codes
into a log file. To check on a detached build, poll `curl /api/index/stats` or `--all --list`
(counts `[done]` sets).

**Indexer and API are separate processes.** The index is stored in PostgreSQL on a named
volume, so it persists across `docker compose down`/`up` (cleared only by `down -v`). The API
server caches the hash table in memory and refreshes it from the DB when its
change-signature `(COUNT(*) FROM cards, MAX(indexed_sets.updated_at))` differs, debounced by
`INDEX_REFRESH_SECONDS` (default 5s) — so a running build is picked up live with no restart,
but expect up to that delay before new cards appear in results. No identification is
returned until an index is built (`matches: []`).

**Scryfall etiquette.** The builder talks to Scryfall directly (not through the main app's
`scryfallFetch`), with its own descriptive `SCRYFALL_USER_AGENT` and a
`SCRYFALL_REQUEST_DELAY` between requests (default 100 ms → ≤10 req/s).

### Evaluating accuracy (`backend/app/evaluate.py`)

A harness to measure identification quality before/after scaling or tuning. It picks random
indexed cards, downloads each reference image, applies synthetic distortions (perspective jitter,
brightness/contrast, blur, JPEG recompression, optional 180° flip), runs the matcher, and reports:

```bash
docker compose -f docker-compose-dev.yml exec card-scanner python -m app.evaluate --sample 300
docker compose -f docker-compose-dev.yml exec card-scanner python -m app.evaluate --sample 100 --seed 1 --flip-prob 0.5
```

```
  Stage-1 recall@K   : did the true card survive the pHash shortlist?
  Top-1 (strict)     : exact printing returned at rank 1
  Top-1 (lenient)    : same card (oracle id, any printing) at rank 1
  Recall@N           : true card anywhere in the top-N
  False 'confident'  : flagged confident but actually wrong  (tunes MIN_INLIERS)
```

Failures are written to a CSV (default `<CARDS_DIR>/eval_failures.csv`) showing each missed
card, its rank, and whether it even reached the shortlist — so you can tell a **Stage-1
recall** miss (bump `SHORTLIST_K`/`PHASH_SIZE`) from a **Stage-2** confusion. Change
`FEATURE_DETECTOR`, `SHORTLIST_K`, etc. and re-run to compare configs.

> The distortions model a real **de-skewed crop** (frame-filling, mild residual), so the numbers
> track real-image behaviour reasonably. It is still **self-retrieval** (query = a distorted copy
> of the indexed image), so it can't capture genuine optical differences — but it's a solid,
> reproducible signal for comparing configs and catching regressions. (At 115k cards, K=100:
> ~97% Stage-1 recall, ~97% lenient top-1, 0% false-confident, ~280 ms/query.)
>
> Beware harness artifacts: an earlier "44% recall" scare was a bad `distort()` warp (a
> smeared `BORDER_REPLICATE` border that real de-skew never produces), not a real
> regression. Don't re-index (e.g. bump pHash to 256-bit) on eval numbers alone without a
> sanity check against real photos in `test-images/`.

**There is no automated test suite for the scanner** and no linter/formatter config —
`evaluate.py` plus the sample photos are how Part-2 changes are validated. The main repo's
`npm run lint`, `tsc`, Vitest, and Docker build all exclude this folder.

## Configuration

All tunables live in `backend/app/config.py` and are environment-overridable (the compose
files set `CARDS_DIR` and `DATABASE_URL`; everything else defaults). Add new knobs there
with a comment and a sensible default rather than hardcoding thresholds in modules.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CARDS_DIR` | `<repo>/data/cards` (`/data/cards` in Docker) | Where crops + debug overlays are written and served from (`/cards`). |
| `DATABASE_URL` | `postgresql://cardscanner:cardscanner@localhost:5432/cardscanner` | Postgres connection string for the index. |
| `INDEX_ERROR_LOG` | `<CARDS_DIR>/index_errors.log` | Append-only log of per-card index failures. |
| `INDEX_REFRESH_SECONDS` | `5` | How often the API re-checks the DB for index changes. |
| `WORK_LONG_EDGE` | `1000` | Long edge (px) of the downscaled working copy used for contour finding. |
| `MIN_AREA_RATIO` / `MAX_AREA_RATIO` | `0.02` / `0.98` | Quad area bounds as a fraction of the frame. |
| `APPROX_EPSILON_RATIO` | `0.02` | `approxPolyDP` epsilon as a fraction of contour perimeter. |
| `CANNY_LOW` / `CANNY_HIGH` | `75` / `200` | Canny hysteresis thresholds. |
| `OUTPUT_HEIGHT` | `680` | Crop height in px; width follows the 63:88 card ratio (→ 487). |
| `SAVE_DEBUG_OVERLAY` | `true` | Also write `<batch>_debug.jpg` with detected quads drawn. |
| `JPEG_QUALITY` | `92` | Quality of saved crops. |
| `PHASH_SIZE` / `PHASH_HIGHFREQ_FACTOR` | `8` / `4` | 8 → 64-bit hash; DCT input is `8×4 = 32px` square. |
| `SHORTLIST_K` | `100` | Stage-1 candidates passed to Stage 2. |
| `FEATURE_DETECTOR` | `orb` | `orb` or `sift`. |
| `ORB_FEATURES` / `SIFT_FEATURES` | `500` / `500` | Feature caps per image. |
| `RATIO_TEST` | `0.75` | Lowe ratio-test cutoff. |
| `MIN_INLIERS` | `15` | RANSAC inlier floor for a `confident` match. |
| `CONFIDENT_MARGIN` | `2.0` | Top match must beat the best *different* card's inliers by this factor. |
| `MIN_GOOD_MATCHES` | `8` | Defined for a good-match floor but currently unused by the matcher. |
| `TOP_N_MATCHES` | `5` | Ranked candidates returned per detected card. |
| `SCRYFALL_USER_AGENT` | `card-scanner-prototype/0.1 (local prototype)` | UA for index/eval downloads. |
| `SCRYFALL_REQUEST_DELAY` | `0.1` | Seconds between Scryfall requests during indexing. |
| `SCRYFALL_IMAGE_FORMAT` | `normal` | Scryfall image size to index (`small` / `normal` / `large`). |
| `EXCLUDED_SET_TYPES` | `minigame,token,vanguard,treasure_chest` | `set_type`s skipped by `--all`. |

The `db` service credentials default to `cardscanner/cardscanner`.

## Gotchas

- **Postgres, not SQLite.** Migrated 2026-06-10. SQLite had to live on a named volume because
  its locking fails over Docker Desktop's macOS bind mounts (`disk I/O error`); Postgres
  removed that constraint. Don't reintroduce SQLite.
- **DB access is raw SQL through the psycopg v3 pool — no ORM.** The hot path bulk-loads every
  hash into a NumPy array, which suits plain SQL. Keep it that way.
- **`opencv-python-headless`** is used so the Docker image needs no GUI/GL system libs. Don't
  switch to plain `opencv-python` (it would need libGL etc.).
- **EXIF orientation** matters: images are decoded with Pillow so phone-photo rotation is
  correct. OpenCV alone ignores EXIF.
- **At full-collection scale**, revisit hash size (64→256-bit) and the ORB feature cap; the
  brute-force Stage-1 scan stays sub-millisecond well past 100k cards, so an ANN index isn't
  needed yet.
- **Code-comment quality is a first-class requirement** here: every module has a docstring,
  functions have docstrings, and non-obvious logic has an inline *why*. Match that bar.

## Project layout

```
backend/
  app/
    config.py        # tunable thresholds & paths (env-overridable)
    detection.py     # Part 1 — OpenCV: find quads + four-point de-skew
    hashing.py       # Part 2 — Stage 1: DCT pHash + vectorised Hamming
    features.py      # Part 2 — Stage 2: ORB/SIFT + RANSAC scoring + (de)serialize descriptors
    index_db.py      # Part 2 — Postgres schema + access (psycopg pool, raw SQL)
    matcher.py       # Part 2 — two-stage identify(), auto-reloading in-memory hash cache
    build_index.py   # Part 2 — CLI: build index from Scryfall per set / --all (resumable)
    evaluate.py      # Part 2 — CLI: accuracy harness (synthetic self-retrieval)
    main.py          # FastAPI: /health, /api/scan, /api/index/stats, /cards static mount
  Dockerfile         # python:3.12-slim + requirements; runs uvicorn on :8000
  requirements.txt
frontend/            # standalone Vite harness (not used by the main app)
  src/
    App.tsx
    api.ts
    types.ts         # mirrors the /api/scan JSON contract
    components/CameraCapture.tsx
    components/CardResults.tsx   # crops + ranked identifications + debug-overlay toggle
  vite.config.ts     # dev proxy: /api + /cards -> http://localhost:8000
data/cards/          # standalone-mode crops + index_errors.log (gitignored except .gitkeep)
test-images/         # sample phone photos of cards, for manual testing
docker-compose.yml   # standalone: db (Postgres + pgdata volume) + backend
```

## Lineage

The two-stage strategy (query-only orientation flip, histogram equalization,
descriptors-not-images in the DB, wide hash shortlist) is reused from the author's earlier
Java recognizer, **YAMCR** (Yet Another Magic Card Recognizer). This project swaps SURF for
ORB/SIFT (SURF is patented and absent from pip OpenCV) and adds RANSAC homography
verification (YAMCR scored by descriptor association only).

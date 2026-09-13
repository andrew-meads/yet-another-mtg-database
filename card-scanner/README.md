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
       │                              pHash shortlist ∪ OCR (name + collector line)
       │                                        → ORB + RANSAC re-rank → fusion
       └──────────────── JSON: crop URLs + ranked Scryfall matches ────────────┘
```

**Part 1 is a multi-strategy classical detector** with index-verified candidates (see
[Detection](#how-detection-works-backendappdetectionpy)): it no longer needs a plain white
background. **Part 2 is a three-stage matcher** (see [Identification](#identification-part-2)):
a perceptual-hash shortlist for recall, an OCR stage that reads the card's name and
collector line and *adds* the printings they name, then ORB local-feature + validated RANSAC
homography re-ranking fused with the text evidence for precision. The index is built per-set
from Scryfall and lives in PostgreSQL.

This folder started life as a standalone prototype and still runs standalone (its own
`docker-compose.yml` and a small Vite harness), but in day-to-day use it is run by the main
repo's compose files and driven by the main app's own camera UI.

## Architecture

| Part | Stack | Where |
| --- | --- | --- |
| Backend | FastAPI + Uvicorn + OpenCV (headless) + Pillow + NumPy + onnxruntime/RapidOCR + rapidfuzz | `backend/` — Docker image |
| Database | PostgreSQL 16 (psycopg v3 + pool, raw SQL, no ORM) | `db` / `card-scanner-db` compose service |
| Dev harness | Vite + React 18 + TypeScript | `frontend/` — optional, standalone only |

The backend detects cards, saves each de-skewed crop under `CARDS_DIR`, and serves them at
`/cards/<file>.jpg`. It creates/migrates its Postgres tables on startup (a DB hiccup at boot
is non-fatal; the matcher presents an empty index until Postgres is reachable). CORS is
wide-open (`allow_origins=["*"]`) — fine while the only exposure is on a private Docker
network behind the main app's auth-guarded proxy.

## Running

### As part of the main app (the normal way)

The main repo's `docker-compose-dev.yml` and `docker-compose.yml` both define the scanner
as two services — `card-scanner-db` (Postgres, on the `card-scanner-pgdata` named volume)
and `card-scanner` (the backend, host port `8000`). They pull the prebuilt image
`ghcr.io/andrew-meads/card-scanner-backend` and bind-mount three host directories: the
repo-root `data/cards/` (crops + debug overlays), `data/scryfall-cache/` (the Scryfall image
cache, see [Image cache](#image-cache)) and `card-scanner/test-images/` (read-only, for the
real-photo harness). The dev compose file also publishes Postgres on host port `5432` so the
harnesses and label tooling can run from the host venv.

```bash
# from the repo root
docker compose -f docker-compose-dev.yml up -d
curl http://localhost:8000/health              # -> {"status":"ok","index":<rows>,"ocr":true}
curl http://localhost:8000/api/index/stats     # -> {"cards":0} until an index is built
```

The Next.js app reaches it via `SCANNER_BASE_URL` (default `http://localhost:8000`; the
production compose sets `http://card-scanner:8000`). **Scans return no matches until you
build an index** — see [Building the index](#building-the-index); with the main compose files
the service name is `card-scanner`, e.g.:

```bash
docker compose -f docker-compose-dev.yml exec card-scanner python -m app.build_index tla tle
```

To rebuild the image from this source instead of pulling it (the `runtime` stage is the
default target; `test` runs lint + the test suite inside the same image):

```bash
docker build --target test card-scanner/backend                                       # gate
docker build --target runtime -t ghcr.io/andrew-meads/card-scanner-backend:latest card-scanner/backend
# then `docker compose ... up -d card-scanner` (or push the tag to GHCR)
```

### Standalone (this folder's own compose + the Vite harness)

```bash
cd card-scanner
docker compose up --build            # services: db (Postgres) + backend, port 8000
```

Here the crops land in `card-scanner/data/cards/`, the image cache in
`card-scanner/data/scryfall-cache/`, and the service name is `backend`
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

> **Mobile note:** live camera (`getUserMedia`) needs a secure context — it works on
> `localhost` but not over `http://<lan-ip>`. On a phone, use **Take / choose photo**, which
> opens the native camera even over plain HTTP.

### On the host (tests, harnesses, tooling)

The backend has a Python venv for running the suite and the accuracy harnesses outside
Docker. It needs [`uv`](https://docs.astral.sh/uv/) (it fetches the CPython named in
`backend/.python-version` if the host lacks it):

```bash
npm run scanner:venv     # = make -C card-scanner/backend venv   (one-off)
npm run scanner:test     # pytest (no Postgres / network / models needed)
npm run scanner:lint     # ruff check + format --check
npm run scanner:eval     # real-photo harness against ../test-images (needs Postgres on :5432)
make -C card-scanner/backend models   # download the OCR models into backend/models (for host runs that OCR)
```

## API

### `POST /api/scan`

Multipart form, field `image` (a JPEG/PNG photo).

```bash
curl -F image=@photo.jpg http://localhost:8000/api/scan
# or against a bundled sample:
curl -F image=@"test-images/07-8-sideways-cards.jpg" http://localhost:8000/api/scan
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
      "source": "edges",             // detection strategy that produced the quad
      "detectScore": 0.93,           // geometric candidate score (0-1)
      "hashDistance": 6,             // Hamming distance to the nearest indexed card (verification)
      "orientation": 180,            // rotation applied so the saved crop is upright (0 | 180 | null)
      "ocr": {                       // null when OCR did not run (disabled / models missing)
        "name": { "key": "mind stone", "score": 100.0, "text": "Mind Stone" },
        "candidates": [],
        "collector": { "set": "dmr", "number": "232", "lang": "EN", "rarity": "C" },
        "orientation": 180,
        "elapsedMs": { "full": 142.0, "total": 142.0 },
        "lines": [ { "text": "Mind Stone", "conf": 0.98, "source": "full" } ]   // OCR_LINES_IN_RESPONSE
      },
      "matches": [                   // ranked best-first; [] if no index built
        {
          "scryfallId": "…", "name": "Mind Stone",
          "set": "dmr", "collectorNumber": "232", "face": "single",
          "hammingDistance": 6,          // Stage-1 pHash distance (lower = closer)
          "featureScore": 130.136, "inliers": 130, "goodMatches": 136,
          "fusedScore": 151.7,           // inliers + name/collector/border bonuses - hash tie-break
          "confident": true,             // see "Confidence" below
          "confidenceRule": "C",         // "A" image margin | "B" name-anchored | "C" collector-anchored | null
          "nameMatch": { "key": "mind stone", "score": 100.0 },
          "collectorMatch": { "set": "dmr", "number": "232", "lang": "EN" },
          "shortlistSources": ["cn", "hash", "name"],   // how it entered the shortlist
          "rotation": 180,               // this candidate's validated homography says the crop was upside down
          "imageUrl": "https://cards.scryfall.io/…",
          "scryfallUri": "https://scryfall.com/card/…"
        }
      ]
    }
  ],
  "debugUrl": "/cards/<batch>_debug.jpg",   // null if SAVE_DEBUG_OVERLAY=0
  "debug": { … }                            // only with DEBUG_JSON=1: candidate counts + rejected quads
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

Liveness probe: `{ "status": "ok", "index": <rows loaded>, "ocr": <bool> }`. `ocr` is
false when the OCR models are missing or the stage is disabled — scans still work, on the
pure pHash → ORB path.

## How detection works (`backend/app/detection.py`)

`detect()` (and the thin `detect_and_deskew()` wrapper) runs a funnel of candidate
generation → geometric filtering → index verification → non-maximum suppression → corner
refinement → warp. Modules: `candidates.py` (strategies, filters, NMS), `verify.py`
(hash verification), `geometry.py` (quads, IoU, warps, corner refinement).

1. **Decode (EXIF-aware)** with Pillow so phone-photo orientation is correct, and downscale
   a working copy (long edge → `WORK_LONG_EDGE`, ~1000 px). Corners are mapped back onto
   the full-res original for the final warp.
2. **Candidate strategies** (`DETECT_STRATEGIES`, default `edges,color`):
   - **Edges** — a bounded sweep of edge maps: gray (optionally CLAHE-equalised), HSV
     saturation and Lab a/b channels (a black border on a green mat or brown wood has no
     luminance edge but a strong chroma edge), several blur sizes and auto-Canny thresholds
     derived from the median intensity (`CANNY_MODE=fixed` reproduces the old 75/200),
     combined as `gray` and `gray|S|a|b`, closed with a dilate *and* a morphological close
     (bridges glare gaps), and contoured with `RETR_LIST` so a card that is an *inner*
     contour of a textured background is still found.
   - **Colour mask** — models the surface colour from the image's border ring (Lab median),
     thresholds the ΔE distance, and contours the mask: the strategy for uniform non-white
     surfaces (dark table, black cloth, plain playmat). Because a black border merges with a
     dark surface it also emits a border-expanded twin (63/57 × 88/82) and lets verification
     pick.
   - **Grid split** (`SPLIT_TOUCHING`, off by default: half a card hashes as well as a whole
     one, so it needs touching-card photos to tune against) — a candidate whose aspect is
     n×63 : m×88 is tiled and each tile verified individually.
   Every contour becomes a quad through `quad_from_contour`: convex hull → `approxPolyDP`
   at several epsilons → for 5–10 vertices the four longest edges are intersected → a
   `minAreaRect` fallback when the hull is rectangular enough.
3. **Filters** with reason codes (`area`, `concave`, `angles`, `aspect`, `rect`,
   `edge_support`): interior angles 90° ± 30°, aspect 0.55–0.92 (a 63:88 card is 0.716; a
   30° tilt scales one axis by ~0.87), rectangularity and edge support floors.
4. **Verification** — each surviving quad is warped to a small thumbnail and its pHash
   compared with the whole index (`matcher.nearest_hash_distance`, ~1 ms): a real card lands
   within `VERIFY_MAX_HAMMING` (8) bits of *some* indexed card, a piece of table does not
   (measured with `evaluate_photos --hash-histogram`: true quads 2–8, random card-shaped
   rectangles 10–18). Distances up to `VERIFY_AMBIGUOUS_HAMMING` (16) are kept as `ambiguous`. After
   identification a second gate (`verify.orb_gate`) drops any detection whose best match has
   fewer than `VERIFY_MIN_INLIERS` validated inliers — on the labelled photos every real card
   scores ≥ 26 and every false quad 0 — restricted to the `ambiguous` ones with
   `VERIFY_ORB_GATE=ambiguous`. `VERIFY_MODE=auto` only
   rejects when the index holds at least `VERIFY_MIN_INDEX_SIZE` rows — **a partially built
   per-set index must never drop cards from other sets** — and degrades to ranking-only when
   the index is empty. The winning hash variant (0° / 180°) also gives the orientation.
5. **NMS** — IoU 0.5 and containment 0.9 across all strategies, ordered verified >
   ambiguous > unverified, then hash distance, then *consensus* (a real card outline is re-found
   by ~30 of the 32 sweep passes, a card-plus-tile-line once; `NMS_CONSENSUS_HITS`), score,
   area; nested art/text boxes lose to the card that contains them.
6. **Refinement + warp** — corners are refined at full resolution (intensity profiles along
   each side's outward normal, outermost strong gradient, Huber `fitLine`, guarded), then a
   single-resample warp produces the 487×680 portrait crop (63:88, Scryfall "normal" size)
   and keeps the 2× warp for the OCR band passes. The crop is rotated to upright once
   identification confirms the orientation.

The debug overlay (`SAVE_DEBUG_OVERLAY`) draws accepted quads with their source, hash
distance and score, and — with `DEBUG_OVERLAY_REJECTED` — the rejected candidates coloured
by reason with a legend and timings; `DEBUG_SAVE_INTERMEDIATE` also writes the OR-ed edge
map and colour mask. `DEBUG_JSON` adds the candidate/rejection lists to the response.

### Known limitations

- **Overlapping (partially occluded) cards**: the top card is found; the occluded one is not
  completed from its visible corners. Strongly patterned playmats can still defeat the
  classical strategies — both are the case for the planned learned detector (see the
  plan's Phase 2).
- **Strong glare** can break the outline; verification + the colour mask recover most cases.

## Identification (Part 2)

Each de-skewed crop is identified by a **three-stage matcher** (`backend/app/matcher.py`)
against a **PostgreSQL** index of Scryfall card images.

1. **Stage 1 — pHash shortlist (recall)** `hashing.py`
   64-bit DCT perceptual hash; rank the whole index by Hamming distance (vectorised NumPy
   popcount) and keep the top `SHORTLIST_K`. The query is hashed at 0° **and** 180° (cards
   may be upside-down) and the closer wins — only the query needs both orientations, the
   index stores one. `QUERY_GLARE_MASK` optionally inpaints specular highlights first.
2. **Stage 1.5 — OCR (recall for the shortlist, precision for the printing)** `ocr.py`,
   `names.py`, `fusion.py`
   RapidOCR (PaddleOCR's text detector / line-orientation classifier / recogniser as ONNX
   models on onnxruntime, pinned by `ocr_models.py`) reads the crop: **detect everywhere,
   recognise selectively** — one full-crop detection finds text boxes at any angle (a
   title bar, a split card's sideways halves, an upside-down card), and only the tallest
   `OCR_MAX_LINES` boxes plus those inside the top/bottom bands are recognised (titles are
   the tallest text on virtually every frame; recognition costs ~20 ms per line). The band
   passes (a native-resolution re-read of the bottom band and the rotated top band from the
   2× warp) run only when the full pass produced no collector line (`OCR_BANDS_LAZY`).
   Every recognised line is a name candidate: `names.match_names` fuzzy-matches them
   (`rapidfuzz`, whole-line ratio with short-name guards and a coverage-limited partial
   pass) against ~35k normalised keys — full names, split halves, DFC faces, flavor names
   ("Azula, Flame of Ember Island" for *Diaochan, Artful Beauty*) — and
   `names.parse_collector_line` parses the bottom-left line (`0150 R`, `184/261 C`,
   `M 0117`, `TLA • EN`, promo `★`, OCR confusions of the set code validated against known
   codes). The printings they name are **added** to the shortlist
   (`fusion.build_shortlist`: collector rows → up to `NAME_MAX_ROWS` per name by lowest
   Hamming → the pHash top-K, capped at `SHORTLIST_MAX`). OCR never *filters*: a failure
   (foil glare, a Japanese name, a textless card, missing models) only means nothing is
   added and the pHash shortlist remains the recall floor.
3. **Stage 2 — local-feature re-rank (precision)** `features.py`
   ORB descriptors (histogram-equalised) matched with a Lowe ratio test; with at least
   `MIN_GOOD_MATCHES` survivors a RANSAC homography is fitted and **validated** — both
   images are de-skewed portrait cards, so a true match is a near-similarity with rotation
   ≈ 0° or 180°, scale ≈ 1 and no perspective; wild fits on the wrong card are discarded
   rather than counted. The validated inlier count is the score (the good-match count only
   breaks ties). Deserialised descriptors of recently scored rows are kept in an LRU
   (`DESC_CACHE_ROWS`), rows are fetched in binary format, and scoring exits early once a
   leader is decisive and its sibling printings are scored.
4. **Fusion + confidence** `fusion.py`
   `fused = inliers + FUSION_NAME_W·name_bonus + FUSION_CN_W·cn_bonus + FUSION_BORDER_W·border_bonus − FUSION_HASH_W·hamming`.
   A weak name misread can never overturn a strong image win; a collector line naming a
   sibling printing of the image's leader *picks that printing* (unless the leader is itself
   consistent with the read — a prerelease promo prints its parent's number, so the stamp the
   features saw decides); a gold/white/silver border that contradicts the crop's measured
   border colour costs several inliers. **`confident`** for the top match holds under rule
   **A** (`MIN_INLIERS` and `CONFIDENT_MARGIN` × the best *different card* — sibling
   reprints don't compete), **B** (a name matched at ≥ `NAME_CONFIDENT_SCORE` with no rival
   within `NAME_AMBIGUITY_GAP` and ≥ `MIN_INLIERS_WITH_NAME` inliers) or **C** (the exact
   collector-line printing with ≥ `MIN_INLIERS_WITH_CN` inliers), with a veto when a name
   matched at ≥ `VETO_SCORE` disagrees with the leader. `confidenceRule` reports which.

The result also carries the crop's **orientation** (the winner's validated homography first,
the OCR line classifier's vote second), which the API uses to save the crop upright.

**Measured on the labelled real photos** (`test-images/`, 17 photos / 68 cards, every quad
verified): detection recall 88.2 % (60/68) at 100 % precision and 0 false positives per photo,
~215 ms per photo; of the 60 crops, 100 % identified at card level, 85 % to the exact printing
(the rest are inherent twins: The List Acornelia printed with UND's collector line, a prerelease
promo, a World Championship gold-border reprint, a German MIR/TSB pair); Stage-1 recall 100 %
(pHash alone 83 %); no false "confident" calls; ~360 ms per crop with OCR (≈ 120 ms without),
of which OCR is ~200 ms. The eight detection misses are the hard cases the last five photos were
shot for: borderless cards packed against neighbours (tight grid, binder page) and cards
overlapped by other cards (fanned hand).

**pHash identifies artwork, not printing.** Same-art reprints across sets are
indistinguishable by appearance, which is why the API returns the top-N (default 5) for a
human to confirm; the collector line now resolves most of them, and "any printing is fine"
remains a deliberate product decision for the rest.

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
picks up where it left off. A full build downloads ~100k images the first time (hours; every
image lands in the [image cache](#image-cache), so later rebuilds are CPU-only) —
`--all --list` first to see the ~800 eligible sets.

Every indexed face also stores the **text metadata** the OCR stage needs (`name_key`,
`face_name_keys`, `collector_number_norm/base`, `layout`, `lang`, `flavor_name`,
`illustration_id`, `border_color`, …; derived in `metadata.py`). An index built before those
columns existed is filled without re-downloading anything:

```bash
docker compose -f docker-compose-dev.yml exec card-scanner python -m app.backfill_metadata   # ~1 minute
```

It streams Scryfall's bulk *Default Cards* export (~80 MB gzipped JSONL) and bumps
`index_meta('metadata_version')`, which the running API notices within `INDEX_REFRESH_SECONDS`.
Until it has run, the matcher silently uses the pure pHash → ORB path (`/health` still reports
`ocr: true` — check `SELECT COUNT(name_key) FROM cards`).

**Change detection (still-releasing sets).** On a re-run, a set is skipped only if its
`card_count` is **unchanged** since last indexed. If the count changed (e.g. a set that's still
being released has gained cards), that set's rows are **wiped and rebuilt** — atomically, in one
transaction, so the API keeps serving the old rows until the rebuild commits. Sets indexed before
`card_count` tracking existed are recorded once (not re-downloaded) on the next run. `--force`
rebuilds every set regardless.

**Progress display.** On an interactive terminal the builder shows a live, in-place 4-line block
that updates per card (no scrolling); when output is piped or detached it falls back to plain
one-line-per-set logging. Per-card failures don't stop the build — they're tallied and appended
in full (context + traceback) to `INDEX_ERROR_LOG` (default `<CARDS_DIR>/index_errors.log`).

**Indexer and API are separate processes.** The index is stored in PostgreSQL on a named
volume, so it persists across `docker compose down`/`up` (cleared only by `down -v`). The API
server caches the Stage-1 data (hashes + the name/collector tables) in memory and refreshes it
when its change-signature `(COUNT(*) FROM cards, MAX(indexed_sets.updated_at),
MAX(index_meta.updated_at))` differs, debounced by `INDEX_REFRESH_SECONDS` (default 5s) — so a
running build or backfill is picked up live with no restart. No identification is returned
until an index is built (`matches: []`).

**Scryfall etiquette.** The builder talks to Scryfall directly (not through the main app's
`scryfallFetch`), with its own descriptive `SCRYFALL_USER_AGENT` and a
`SCRYFALL_REQUEST_DELAY` between requests (default 100 ms → ≤10 req/s), applied only on
image-cache misses.

### Image cache

Every card image the scanner downloads — index builds, the evaluation harness, the synthetic
generator's `--cards cache` mode — is kept under `IMAGE_CACHE_DIR` (`<fmt>/<id[:2]>/<id>_<face>.jpg`;
`/data/scryfall-cache` in Docker, bind-mounted from `data/scryfall-cache/`), so a re-index or a
second evaluation never re-downloads. The full index is ~7–10 GB of `normal` images; set
`IMAGE_CACHE_DIR=""` to disable, or warm just the sets you need:

```bash
python -m app.image_cache stats
python -m app.image_cache warm --set tla tle        # download without indexing
python -m app.image_cache prune --older-than 90
```

## Evaluating accuracy

Three harnesses, all reproducible from a seed. Measure before and after every detection or
identification change; the CI workflow gates on the committed detection baselines.

### Real photos (`backend/app/evaluate_photos.py`)

The reference: `test-images/` holds phone photos and a hand-authored manifest
`test-images.json` (an array of `{fileName, description, cards:[{name, set, number, finish,
extra, name-en, flavorName}]}`). **The manifest is the source of truth**: tooling only appends
machine fields (`quad`, `quadSource`, `background`, `tags`, `lang`, `layout`, `collectorLine`,
`scryfallId`, `kind`) and never rewrites what a human wrote. Entries without quads already
yield identification metrics; quads add the detection metrics.

```bash
npm run scanner:eval                                  # = evaluate_photos ../test-images with overlays
python -m app.evaluate_photos ../test-images --detection-only --baseline ../benchmarks/real-photos.detection.json
python -m app.evaluate_photos ../test-images --json out.json --csv out.csv --overlay-dir ../test-images/_overlays
python -m app.evaluate_photos ../data/synth-regression --detection-only     # any dir with a test-images.json
```

Reports detection recall / precision at IoU ≥ 0.7, corner error (px and % of card width),
false positives per photo, identification top-1 / top-N in three tiers — **strict** (exact
Scryfall id), **family** (same set + base collector number, so a prerelease twin counts) and
**lenient** (same card, any printing) — Stage-1 recall (union vs pHash alone), OCR name /
collector accuracy, false-confident, latency, all per background; `--baseline` diffs against a
saved report and exits 2 on regression (the CI gate). Overlays draw ground truth, matches,
false positives and misses.

**Two real-photo baselines.** Every report records the verification mode that ran
(`summary.verify_mode`) and the index size, and `--baseline` refuses to compare reports whose
modes differ — with the index, pHash verification (`filter`) throws away card-shaped
non-cards such as the blob a whole 3×3 grid makes; without it (`rank`/`off`) that blob wins
NMS and suppresses the nine real cards, so the two are different detectors.
`benchmarks/real-photos.detection.json` is recorded with the live index (the numbers quoted
in this README); `benchmarks/real-photos.detection.noindex.json` is recorded with
`VERIFY_MODE=off` and is what CI, which has no Postgres, diffs against. `make baseline`
regenerates both; commit them together.

**Labelling photos.** `python -m app.label_photos --import photo.jpg --slug wood-dark-3cards
--background wood-dark` copies a new photo in (EXIF-baked, 3000 px long edge, JPEG q85),
continues the `NN-slug.jpg` naming and appends a manifest entry for you to fill in the same
way as the existing ones; `python -m app.label_photos` then drafts the quads with the current
detector (assigning detections to your listed cards by identity, not order) and writes numbered
overlays to `test-images/_overlays/` for a glance check; `--verify NN` marks them verified;
`--validate [--resolve]` checks the manifest (offline, or against the index). For cards the
detector cannot find (borderless cards packed against neighbours, cards under other cards) or
draws inset (glare-washed foil borders), type a rough quad by eye — any corner order — and run
`python -m app.label_photos --refine [NN,NN]`: it matches the card's Scryfall image into the
quad's warp with SIFT and projects the reference corners back, which lands within a few pixels
of the true edges, fixes the printed order and completes hidden corners; a fit is refused
(and the quad left alone) when too few features agree or a corner would move more than 15 % of
the card's short side, the signature of locking onto a neighbouring card with the same frame.
Refined quads come back as drafts (`<stem>.refine.jpg` shows old in red, new in green) for the
usual `--verify`. Photos are stored
at 3000 px (~1.5 MB each); labels always in git; no Git LFS.

### Synthetic composites (`backend/app/synth.py`)

Unlimited labelled "photos" for detection: procedural fake cards (or real cached Scryfall
images with `--cards cache`) composited onto procedural surfaces — paper, solid, gradient,
noise, wood, fabric, playmat, tiles — or your own background photos, with perspective,
rotation, shadows, glare, overlaps and JPEG degradation, plus exact printed-order quads in the
same manifest format. Presets `easy|medium|hard|mixed|regression`; `--export-yolo` writes
polygon labels for a future learned detector.

```bash
python -m app.synth --preset regression --out ../data/synth-regression    # fixed seed, 120 images
python -m app.synth --out /tmp/hard --n 50 --preset hard --backgrounds both:/path/to/my/surfaces
```

### Synthetic self-retrieval (`backend/app/evaluate.py`)

Picks random indexed cards, re-downloads (or reads from the cache) each reference image,
distorts it like a real de-skewed crop, and measures retrieval — a fast, reproducible signal
for comparing configs; it cannot capture real optical differences.

```bash
python -m app.evaluate --sample 300
python -m app.evaluate --sample 100 --seed 1 --ocr on --image-format large    # collector-line OCR needs `large`
```

Reports Stage-1 recall (union and pHash-alone), top-1 strict / lenient, recall@N,
false-confident by rule, OCR name / collector accuracy by layout, and per-stage latency;
failures (wrong card *and* wrong printing) go to a CSV with the OCR reads.

> Beware harness artifacts: an earlier "44% recall" scare was a bad `distort()` warp, not a
> real regression. Don't re-index on eval numbers alone without a sanity check against the
> real photos.

## Testing & linting

```bash
npm run scanner:venv && npm run scanner:test && npm run scanner:lint     # host (uv venv)
make -C card-scanner/backend test ARGS="tests/test_matcher.py -k confident"
SCANNER_INTEGRATION=1 make -C card-scanner/backend test ARGS="tests/test_integration_index.py"   # scratch Postgres DB
docker build --target test card-scanner/backend                          # inside the runtime image
```

`backend/tests/` covers the pure helpers (geometry, hashing, name normalisation, collector-line
parsing, fusion, metadata), detection on synthetic composites over every background kind, the
matcher against a fake in-memory index (with and without a fake OCR engine), the OCR engine's
selection / band / orientation logic with a fake backend, the image cache and Scryfall client
with fake downloads, and the FastAPI app through `TestClient`. Unit tests never open Postgres
(the pool is blocked, so a stray query fails fast instead of timing out), never touch the
network, and run with OCR disabled; `integration` / `network` marked tests need
`SCANNER_INTEGRATION=1` / `SCANNER_NETWORK=1`. CI: `.github/workflows/card-scanner.yml`
(lint, tests, manifest validation, both detection harnesses against the committed baselines,
and the Docker `test` stage) — triggered manually from the Actions tab or with
`gh workflow run card-scanner`, not on push.

**Regression workflow.** After a change: `make test`, then `make eval-photos` and the
synthetic set (`make synth` + `evaluate_photos ../data/synth-regression --detection-only
--baseline ../benchmarks/synth-regression.detection.json`); accept new numbers with
`make baseline` (regenerates both real-photo baselines; commit the JSON with the change, never
to make a red run green). Config knobs are env vars, so A/B runs need
no code edits (`CANNY_MODE=fixed python -m app.evaluate_photos …`).

## Versions

Dependencies are floors in `requirements.txt` / `requirements-dev.txt`; the exact tested set
is the generated `requirements.lock` / `requirements-dev.lock` (`uv pip compile`, universal),
which the Dockerfile, CI and the host venv install with `--no-deps`. `make upgrade`
re-resolves to the newest compatible versions — run the suite and both harnesses before
committing the new locks. The Python version is chosen by the stack (the newest CPython every
locked wheel supports; 3.14 today) and lives in `.python-version` + the Dockerfile `FROM`;
bump them together. `overrides.txt` removes the GUI `opencv-python` that `rapidocr` declares
(the headless build is the only `cv2`; the Docker build asserts it). OCR models are listed in
`app/ocr_models.py` (URL + SHA-256 from RapidOCR's own table for the locked release) and
selected by `OCR_DET_MODEL` / `OCR_CLS_MODEL` / `OCR_REC_MODEL`; the `server` recogniser
variants are the accuracy upgrade if the harness shows misreads on stylised fonts.

## Configuration

All tunables live in `backend/app/config.py` and are environment-overridable (the compose
files set `CARDS_DIR`, `DATABASE_URL` and `IMAGE_CACHE_DIR`; everything else defaults). Add
new knobs there with a comment and a sensible default rather than hardcoding thresholds.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CARDS_DIR` | `<repo>/data/cards` (`/data/cards` in Docker) | Where crops + debug overlays are written and served from (`/cards`). |
| `DATABASE_URL` | `postgresql://cardscanner:cardscanner@localhost:5432/cardscanner` | Postgres connection string for the index. |
| `IMAGE_CACHE_DIR` | `<CARDS_DIR>/../scryfall-cache` | On-disk cache of downloaded Scryfall images (`""` disables). |
| `INDEX_ERROR_LOG` | `<CARDS_DIR>/index_errors.log` | Append-only log of per-card index failures. |
| `INDEX_REFRESH_SECONDS` | `5` | How often the API re-checks the DB for index / metadata changes. |
| **Detection** | | |
| `WORK_LONG_EDGE` | `1000` | Long edge (px) of the downscaled working copy used for candidate finding. |
| `DETECT_STRATEGIES` | `edges,color` | Candidate strategies to run. |
| `CANNY_MODE`, `CANNY_SIGMAS`, `CANNY_LOW`/`CANNY_HIGH`, `WORK_LONG_EDGES` | `auto`, `0.33,0.66`, `75`/`200`, `1000` | Auto-Canny from the median intensity (or the fixed thresholds); working scales of the sweep. |
| `BLUR_KERNELS`, `EDGE_CHANNELS`, `EDGE_CLAHE`, `MORPH_CLOSE_KERNEL`, `CONTOUR_MODE` | see `config.py` | The edge-sweep parameters. |
| `MIN_AREA_RATIO` / `MAX_AREA_RATIO`, `MIN_SIDE_PX` | `0.01` / `0.98`, `40` | Candidate size bounds. |
| `APPROX_EPSILONS`, `MIN_RECTANGULARITY`, `MAX_ANGLE_DEV_DEG`, `ASPECT_MIN`/`ASPECT_MAX`, `MIN_EDGE_SUPPORT`, `EDGE_SUPPORT_TOLERANCE` | see `config.py` | Quad extraction and the geometric filters. |
| `NMS_IOU`, `NMS_CONTAINMENT`, `NMS_CONSENSUS_HITS`, `NMS_UNVERIFIED_ORDER`, `MAX_CARDS` | `0.5`, `0.9`, `6`, `area`, `20` | Non-maximum suppression. |
| `VERIFY_MODE`, `VERIFY_MAX_HAMMING`, `VERIFY_AMBIGUOUS_HAMMING`, `VERIFY_MIN_INDEX_SIZE`, `VERIFY_THUMB_LONG_EDGE`, `VERIFY_MIN_INLIERS`, `VERIFY_ORB_GATE`, `MAX_AMBIGUOUS` | `auto`, `8`, `16`, `50000`, `180`, `8`, `all`, `6` | Index verification of candidates (hash zones, then the Stage-2 inlier gate). |
| `BG_MODE`, `BG_BORDER_FRACTION`, `BG_DELTA_E`, `BG_MAX_SPREAD`, `BG_EMIT_EXPANDED` | `auto`, `0.04`, `12`, `14`, `true` | Colour-mask strategy. |
| `SPLIT_TOUCHING` | `false` | Grid split of merged touching cards (opt-in). |
| `REFINE_CORNERS`, `REFINE_BAND_IN`, `REFINE_BAND_OUT`, `REFINE_SAMPLES` | `true`, `0.015`, `0.06`, `64` | Full-resolution corner refinement. |
| `OUTPUT_HEIGHT` | `680` | Crop height in px; width follows the 63:88 card ratio (→ 487). |
| `SAVE_DEBUG_OVERLAY`, `DEBUG_OVERLAY_REJECTED`, `DEBUG_MAX_REJECTED`, `DEBUG_SAVE_INTERMEDIATE`, `DEBUG_JSON` | `true`, `true`, `40`, `false`, `false` | Debug outputs. |
| `SCAN_WORKERS` | `2` | Crops of one photo identified in parallel. |
| `JPEG_QUALITY` | `92` | Quality of saved crops. |
| **Stage 1** | | |
| `PHASH_SIZE` / `PHASH_HIGHFREQ_FACTOR` | `8` / `4` | 8 → 64-bit hash; DCT input is `8×4 = 32px` square. |
| `SHORTLIST_K` | `100` | pHash candidates passed on (before the OCR union). |
| `QUERY_GLARE_MASK` | `false` | Inpaint specular glare before hashing the query. |
| **OCR** | | |
| `OCR_ENABLED` | `true` | Run the OCR stage (false → pure pHash → ORB). |
| `OCR_MODEL_DIR`, `OCR_DET_MODEL`, `OCR_CLS_MODEL`, `OCR_REC_MODEL` | `/app/models`, `det:PP-OCRv6_small`, `cls:PP-OCRv5_mobile`, `rec:en_PP-OCRv5_mobile` | Model files (keys of `ocr_models.MODELS`). |
| `OCR_THREADS`, `OCR_MAX_LINES`, `OCR_MIN_LINE_HEIGHT_FRAC`, `OCR_BAND_FRACTION`, `OCR_BAND_PASSES`, `OCR_BANDS_LAZY`, `OCR_MIN_CONF`, `OCR_DET_LIMIT_SIDE`, `OCR_MAX_HEIGHT`, `OCR_LINES_IN_RESPONSE` | `4`, `6`, `0.02`, `0.10`, `true`, `true`, `0.7`, `1400`, `1400`, `true` | Selective recognition, band passes, confidence floor. |
| `NAME_MIN_SCORE`, `NAME_SHORT_LEN`, `NAME_MID_LEN`, `NAME_MID_SCORE`, `NAME_TOP_M`, `NAME_AMBIGUITY_GAP`, `NAME_PARTIAL_MIN_LEN`, `NAME_PARTIAL_MIN_SCORE`, `NAME_PARTIAL_MIN_COVERAGE` | `80`, `5`, `7`, `90`, `3`, `5`, `10`, `92`, `0.4` | Fuzzy name matching. |
| `NAME_MAX_ROWS`, `SHORTLIST_MAX` | `40`, `220` | Union shortlist caps. |
| **Stage 2 + fusion** | | |
| `FEATURE_DETECTOR`, `ORB_FEATURES` / `SIFT_FEATURES`, `RATIO_TEST` | `orb`, `500` / `500`, `0.75` | Local features. |
| `MIN_GOOD_MATCHES` | `8` | Ratio-test survivors needed before a homography is fitted. |
| `HOMOGRAPHY_VALIDATE`, `HOMOGRAPHY_METHOD`, `HOMOGRAPHY_MAX_ITERS`, `HOMOGRAPHY_CONFIDENCE`, `HOMOGRAPHY_MAX_AREA_RATIO`, `HOMOGRAPHY_MAX_CENTER_SHIFT`, `HOMOGRAPHY_MAX_PERSPECTIVE`, `HOMOGRAPHY_ROTATION_TOL` | `true`, `ransac`, `1000`, `0.995`, `2.0`, `0.25`, `2e-3`, `15` | Homography fitting and validation. |
| `DESC_CACHE_ROWS`, `EARLY_EXIT_CHUNK`, `EARLY_EXIT_INLIERS`, `EARLY_EXIT_MARGIN` | `5000`, `25`, `50`, `3.0` | Stage-2 performance. |
| `FUSION_NAME_W`, `FUSION_CN_W`, `FUSION_BORDER_W`, `FUSION_HASH_W` | `12`, `10`, `8`, `0.05` | Score fusion weights. |
| `MIN_INLIERS`, `CONFIDENT_MARGIN`, `NAME_CONFIDENT_SCORE`, `MIN_INLIERS_WITH_NAME`, `MIN_INLIERS_WITH_CN`, `VETO_SCORE` | `15`, `2.0`, `92`, `6`, `6`, `95` | Confidence rules A / B / C and the veto. |
| `TOP_N_MATCHES` | `5` | Ranked candidates returned per detected card. |
| **Scryfall** | | |
| `SCRYFALL_USER_AGENT`, `SCRYFALL_REQUEST_DELAY`, `SCRYFALL_IMAGE_FORMAT`, `EXCLUDED_SET_TYPES` | see `config.py` | Index download etiquette and scope. |

The `db` service credentials default to `cardscanner/cardscanner`.

## Gotchas

- **Postgres, not SQLite.** Migrated 2026-06-10. SQLite had to live on a named volume because
  its locking fails over Docker Desktop's macOS bind mounts (`disk I/O error`); Postgres
  removed that constraint. Don't reintroduce SQLite.
- **DB access is raw SQL through the psycopg v3 pool — no ORM.** The hot path bulk-loads every
  hash into a NumPy array, so plain SQL suits it. Rows are fetched in the binary format:
  the descriptor blobs are ~20 KB each and the text protocol hex-encodes them, which was half of
  Stage 2's latency.
- **`opencv-python-headless`** is used so the Docker image needs no GUI/GL system libs. Don't
  switch to plain `opencv-python`, and never let it in as a transitive dependency
  (`overrides.txt` strips the one `rapidocr` declares; the Docker build asserts it).
- **EXIF orientation** matters: images are decoded with Pillow so phone-photo rotation is
  correct. OpenCV alone ignores EXIF.
- **RANSAC is randomised**: the harnesses call `cv2.setRNGSeed` before every query so inlier
  counts are reproducible; do the same in any new measurement.
- **A metadata backfill changes no row count and touches no set**, which is why
  `index_meta.updated_at` is part of the matcher's change signature — without it the API
  would never reload its name tables.
- **A partially built per-set index + `VERIFY_MODE=filter`** would silently drop every card
  from an unindexed set; `auto` only filters above `VERIFY_MIN_INDEX_SIZE` rows.
- **Unit tests never touch Postgres**: the pool is blocked so a stray query fails fast rather
  than waiting out the 10 s pool timeout; OCR is disabled for them too.
- **Code-comment quality is a first-class requirement** here: every module has a docstring,
  functions have docstrings, and non-obvious logic has an inline *why*. Match that bar.

## Project layout

```
backend/
  app/
    config.py            # tunable thresholds & paths (env-overridable)
    detection.py         # Part 1 — orchestration: strategies -> filter -> verify -> NMS -> refine -> warp
    candidates.py        # Part 1 — candidate strategies (edges, colour mask, grid split), filters, NMS
    verify.py            # Part 1 — pHash verification of candidate quads (via the matcher's index)
    geometry.py          # quads: ordering, IoU, matching, warps, quad_from_contour, refine_corners
    hashing.py           # Part 2 — Stage 1: DCT pHash + vectorised Hamming (+ glare mask)
    ocr.py               # Part 2 — Stage 1.5: RapidOCR engine (selective recognition, bands, orientation)
    ocr_models.py        # OCR model registry (URL + SHA-256) and downloader
    names.py             # normalised name keys, fuzzy matching, collector-line parsing, lookup table
    fusion.py            # union shortlist, score fusion, border colour, confidence rules, promotion
    metadata.py          # per-face text metadata derived from Scryfall card JSON
    features.py          # Part 2 — Stage 2: ORB/SIFT + validated RANSAC + (de)serialize descriptors
    index_db.py          # Part 2 — Postgres schema/migrations + access (psycopg pool, raw SQL)
    matcher.py           # Part 2 — identify_card(): all stages, auto-reloading in-memory cache
    scryfall.py          # Scryfall HTTP client (User-Agent, throttle, retries)
    image_cache.py       # on-disk cache of downloaded card images (+ CLI)
    build_index.py       # CLI: build index from Scryfall per set / --all (resumable)
    backfill_metadata.py # CLI: fill the text-metadata columns from the bulk export (no images)
    labels.py            # test-images.json manifest: load/save/validate/resolve
    label_photos.py      # CLI: import photos, draft quads, refine against Scryfall images, verify, validate
    evaluate_photos.py   # CLI: real-photo accuracy harness (detection + identification + OCR)
    evaluate.py          # CLI: synthetic self-retrieval harness
    synth.py             # fake cards, procedural backgrounds, composite generator (+ CLI)
    main.py              # FastAPI: /health, /api/scan, /api/index/stats, /cards static mount
  tests/                 # pytest suite (see Testing & linting)
  Dockerfile             # python:3.14-slim; stages base -> test -> runtime (default)
  Makefile               # venv / test / lint / format / upgrade / models / eval-photos / baseline / synth
  pyproject.toml         # pytest + ruff config
  requirements*.txt, requirements*.lock, overrides.txt, .python-version
benchmarks/              # committed harness baselines (CI gates)
frontend/                # standalone Vite harness (not used by the main app)
data/cards/              # standalone-mode crops + index_errors.log (gitignored except .gitkeep)
data/scryfall-cache/     # standalone-mode image cache (gitignored)
test-images/             # labelled phone photos + test-images.json (the manifest)
docker-compose.yml       # standalone: db (Postgres + pgdata volume) + backend
```

## Lineage

The two-stage strategy (query-only orientation flip, histogram equalization,
descriptors-not-images in the DB, wide hash shortlist) is reused from the author's earlier
Java recognizer, **YAMCR** (Yet Another Magic Card Recognizer). This project swaps SURF for
ORB/SIFT (SURF is patented and absent from pip OpenCV), adds RANSAC homography verification
(YAMCR scored by descriptor association only), and layers the OCR stage and the fusion on top.

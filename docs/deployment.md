# Deployment

Multi-stage `Dockerfile` (Node 22) + `docker-compose.yml` running the app, MongoDB, and the
card-scanner stack (`card-scanner` from the prebuilt `ghcr.io/andrew-meads/card-scanner-backend`
image + `card-scanner-db`, Postgres 16) behind a Caddy reverse proxy (configured via labels
in compose). Production sets
`NODE_ENV=production`, so real Google login is used (the dev login provider is never
registered — see [auth.md](auth.md)).

```bash
docker compose up -d --build
```

For local development use `docker-compose-dev.yml` instead — the same stack minus the app
service and the reverse proxy (MongoDB on host port `27017`, the scanner on `8000`), with
the Next.js app run on the host via `npm run dev`.

## Card-scanner image and index

The scanner's source is in `card-scanner/backend` (see
[card-scanner/README.md](../card-scanner/README.md)); the compose files pull the prebuilt
image rather than building it, and the app's `.dockerignore` excludes `card-scanner/` from
the Next.js build context. To ship a scanner change, rebuild and push the image:

```bash
docker build --target runtime -t ghcr.io/andrew-meads/card-scanner-backend:latest card-scanner/backend
docker push ghcr.io/andrew-meads/card-scanner-backend:latest
```

Run the suite inside the image first: `docker build --target test card-scanner/backend`
(the `runtime` stage is the default target; `test` adds the dev dependencies and runs
ruff + pytest). The compose files bind-mount `data/scryfall-cache` (the Scryfall image
cache that makes re-indexing a one-time download; ~7-10 GB for the full index) and
`card-scanner/test-images` (read-only, for the real-photo harness) into the container,
and set `IMAGE_CACHE_DIR`. The image also downloads and SHA-verifies its OCR models at
build time, so the running service never talks to the model host.


The identification index lives in Postgres on the `card-scanner-pgdata` named volume (kept
across `down`/`up`, wiped only by `down -v`), so a fresh deployment must build it once:

```bash
docker compose exec card-scanner python -m app.build_index --all   # resumable; hours
```

Crops and the index error log are bind-mounted to `./data/cards` on the host.

## Response compression happens at Caddy

The `caddy.encode: zstd gzip` label in `docker-compose.yml` does the compression. Next's
built-in gzip (`compress`, default on for `next start`) does **not** fire for `/api/*`
routes in practice: every API request passes through the `src/proxy.ts` middleware, and
Next's middleware-response path strips `accept-encoding` before the compression check
runs. Hitting port 3000 directly therefore serves uncompressed responses — go through
Caddy (or your own proxy) for compressed transfer. The same Caddy `encode` layer is a
possible SSE-buffering risk for the streaming AI chat route (see `AI_ROADMAP.md`).

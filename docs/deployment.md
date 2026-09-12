# Deployment

Multi-stage `Dockerfile` (Node 22) + `docker-compose.yml` running the app, MongoDB, and the
external card-scanner stack (`ghcr.io/andrew-meads/card-scanner-backend` + its Postgres DB)
behind a Caddy reverse proxy (configured via labels in compose). Production sets
`NODE_ENV=production`, so real Google login is used (the dev login provider is never
registered — see [auth.md](auth.md)).

```bash
docker compose up -d --build
```

For local development use `docker-compose-dev.yml` instead — the same stack minus the app
service and the reverse proxy (MongoDB on host port `27017`, the scanner on `8000`), with
the Next.js app run on the host via `npm run dev`.

## Response compression happens at Caddy

The `caddy.encode: zstd gzip` label in `docker-compose.yml` does the compression. Next's
built-in gzip (`compress`, default on for `next start`) does **not** fire for `/api/*`
routes in practice: every API request passes through the `src/proxy.ts` middleware, and
Next's middleware-response path strips `accept-encoding` before the compression check
runs. Hitting port 3000 directly therefore serves uncompressed responses — go through
Caddy (or your own proxy) for compressed transfer. The same Caddy `encode` layer is a
possible SSE-buffering risk for the streaming AI chat route (see `AI_ROADMAP.md`).

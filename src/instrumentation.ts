/**
 * Next.js instrumentation hook — `register()` runs once when the server boots.
 *
 * We use it to give the Node server's global `fetch` a custom `User-Agent` so
 * that Next's image optimizer can fetch Scryfall card images (Scryfall's CDN now
 * rejects requests sent with undici's default User-Agent). See
 * `src/lib/server/defaultUserAgent.ts` for details.
 */
export async function register() {
  // Only patch the Node.js runtime — the edge runtime never runs the optimizer.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installDefaultUserAgentFetch } = await import("@/lib/server/defaultUserAgent");
    installDefaultUserAgentFetch();
  }
}

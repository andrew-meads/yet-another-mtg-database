/**
 * Helpers for calling the Scryfall API.
 *
 * As of 2024 Scryfall requires every request to send a custom `User-Agent`
 * header (identifying this app, not the HTTP library's default) and an `Accept`
 * header. Requests without them are rejected. See:
 * https://scryfall.com/blog/user-agent-and-accept-header-now-required-on-the-api-225
 */

/** Headers Scryfall requires on every API request. */
export const SCRYFALL_HEADERS: Record<string, string> = {
  "User-Agent": "yet-another-mtg-database/0.1.0 (+https://github.com/andrew-meads/yet-another-mtg-database)",
  Accept: "*/*"
};

/**
 * Minimum delay between consecutive Scryfall requests. Scryfall asks for no more
 * than 10 requests/second (and recommends 50–100 ms between requests), so 100 ms
 * keeps us at or under their ceiling.
 */
const MIN_REQUEST_INTERVAL_MS = 100;

/**
 * Serializes Scryfall request *starts* so that consecutive requests begin at
 * least `MIN_REQUEST_INTERVAL_MS` apart. This is an in-process limiter: it
 * relies on this module being a long-lived singleton (true for `next start` /
 * the Docker server), and does not coordinate across multiple app instances.
 */
let scryfallQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function acquireRateLimitSlot(): Promise<void> {
  const slot = scryfallQueue.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  // Keep the chain alive even if a slot's wait somehow rejects.
  scryfallQueue = slot.catch(() => {});
  return slot;
}

/**
 * `fetch` wrapper for the Scryfall API. Always sends the headers Scryfall
 * requires and rate-limits requests to <= 10/second. Use this for any request
 * to `api.scryfall.com` (and Scryfall-hosted asset URLs).
 */
export async function scryfallFetch(
  input: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  await acquireRateLimitSlot();
  return fetch(input, {
    ...init,
    headers: { ...SCRYFALL_HEADERS, ...init.headers }
  });
}

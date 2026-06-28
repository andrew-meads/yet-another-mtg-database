/**
 * Server-side default `User-Agent` for the global `fetch`.
 *
 * Next.js's image optimizer fetches remote images (e.g. Scryfall card art) from
 * the Node server using the global `fetch` (undici). Undici sends a generic,
 * HTTP-library-default `User-Agent`, which Scryfall's image CDN now rejects with
 * `400 { code: "bad_request", subcode: "generic_user_agent" }`. Next exposes no
 * config to set a `User-Agent` on the optimizer's outbound request, so instead we
 * wrap the server's global `fetch` (from `instrumentation.ts`) to attach a custom
 * `User-Agent` whenever the caller hasn't set one. Callers that set their own UA
 * (e.g. `scryfallFetch`) are left untouched.
 */
import { SCRYFALL_HEADERS } from "@/lib/scryfall";

/** Default User-Agent attached to server-side fetches that don't set one. */
export const DEFAULT_USER_AGENT = SCRYFALL_HEADERS["User-Agent"];

type FetchFn = typeof fetch;

/** True if a `User-Agent` header is already present on the given fetch arguments. */
function hasUserAgent(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof Request !== "undefined" && input instanceof Request && input.headers.has("user-agent")) {
    return true;
  }
  const headers = init?.headers;
  if (!headers) return false;
  if (headers instanceof Headers) return headers.has("user-agent");
  if (Array.isArray(headers)) return headers.some(([key]) => key.toLowerCase() === "user-agent");
  return Object.keys(headers).some((key) => key.toLowerCase() === "user-agent");
}

/**
 * Wraps `baseFetch` so that requests without an explicit `User-Agent` get the
 * given one. Requests that already specify a `User-Agent` (in `init.headers` or
 * on a `Request` input) pass through unchanged.
 */
export function createFetchWithDefaultUserAgent(
  baseFetch: FetchFn,
  userAgent: string = DEFAULT_USER_AGENT
): FetchFn {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (hasUserAgent(input, init)) return baseFetch(input, init);

    const headers = new Headers(
      init?.headers ??
        (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined)
    );
    headers.set("User-Agent", userAgent);
    return baseFetch(input, { ...init, headers });
  }) as FetchFn;
}

const INSTALLED_FLAG = "__defaultUserAgentFetchInstalled";

/**
 * Idempotently replaces `globalThis.fetch` with one that injects
 * {@link DEFAULT_USER_AGENT} when no `User-Agent` is set. Safe to call multiple
 * times (e.g. across hot-reloads) — only the first call patches.
 */
export function installDefaultUserAgentFetch(): void {
  const globalAny = globalThis as typeof globalThis & { [INSTALLED_FLAG]?: boolean };
  if (globalAny[INSTALLED_FLAG]) return;
  const base = globalThis.fetch;
  if (typeof base !== "function") return;
  globalThis.fetch = createFetchWithDefaultUserAgent(base.bind(globalThis));
  globalAny[INSTALLED_FLAG] = true;
}

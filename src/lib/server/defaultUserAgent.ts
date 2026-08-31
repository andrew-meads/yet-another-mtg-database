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
 *
 * Why an accessor and not a plain assignment: Next itself re-assigns
 * `globalThis.fetch` with its own instrumentation wrapper — in dev mode it does so
 * *after* `instrumentation.ts` has run (and again on recompiles), which silently
 * replaced a plainly-assigned wrapper and brought the 400s back (dev-only; a
 * production server patches once at boot). So `installDefaultUserAgentFetch`
 * defines `fetch` as a get/set property: every later assignment lands in the
 * setter and is transparently re-wrapped, keeping the UA injection outermost no
 * matter who patches when. The wrapper itself is a `Proxy` so properties Next
 * stamps on its patched fetch (e.g. its "already patched" marker) remain visible
 * through us and Next doesn't re-patch endlessly.
 */
import { SCRYFALL_HEADERS } from "@/lib/scryfall";

/** Default User-Agent attached to server-side fetches that don't set one. */
export const DEFAULT_USER_AGENT = SCRYFALL_HEADERS["User-Agent"];

type FetchFn = typeof fetch;

/** Wrappers created by us, so the setter never double-wraps its own output. */
const ourWrappers = new WeakSet<object>();

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
 * on a `Request` input) pass through unchanged. The wrapper is a transparent
 * `Proxy`: reading/writing properties on it reaches `baseFetch` itself.
 */
export function createFetchWithDefaultUserAgent(
  baseFetch: FetchFn,
  userAgent: string = DEFAULT_USER_AGENT
): FetchFn {
  const wrapper = new Proxy(baseFetch, {
    apply(target, thisArg, args: [RequestInfo | URL, RequestInit?]) {
      const [input, init] = args;
      if (hasUserAgent(input, init)) return Reflect.apply(target, thisArg, args);

      const headers = new Headers(
        init?.headers ??
          (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined)
      );
      headers.set("User-Agent", userAgent);
      return Reflect.apply(target, thisArg, [input, { ...init, headers }]);
    }
  }) as FetchFn;
  ourWrappers.add(wrapper);
  return wrapper;
}

const INSTALLED_FLAG = "__defaultUserAgentFetchInstalled";
type GlobalWithFlag = typeof globalThis & { [INSTALLED_FLAG]?: boolean };

/**
 * Idempotently redefines `globalThis.fetch` as an accessor that keeps a
 * UA-injecting wrapper (see {@link createFetchWithDefaultUserAgent}) outermost:
 * the current fetch is wrapped immediately, and any future assignment to
 * `globalThis.fetch` (e.g. Next.js re-patching it in dev) is re-wrapped by the
 * setter. Safe to call multiple times — only the first call installs.
 */
export function installDefaultUserAgentFetch(): void {
  const globalAny = globalThis as GlobalWithFlag;
  if (globalAny[INSTALLED_FLAG]) return;
  const initial = globalThis.fetch;
  if (typeof initial !== "function") return;

  let current: FetchFn = createFetchWithDefaultUserAgent(initial);
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (next: unknown) => {
      current =
        typeof next === "function" && !ourWrappers.has(next)
          ? createFetchWithDefaultUserAgent(next as FetchFn)
          : (next as FetchFn);
    }
  });
  globalAny[INSTALLED_FLAG] = true;
}

/**
 * Removes the accessor installed by {@link installDefaultUserAgentFetch},
 * leaving the current (still-wrapped) fetch as a plain writable property.
 * Test-only — production never uninstalls.
 */
export function uninstallDefaultUserAgentFetch(): void {
  const globalAny = globalThis as GlobalWithFlag;
  if (!globalAny[INSTALLED_FLAG]) return;
  const current = globalThis.fetch;
  delete (globalThis as { fetch?: FetchFn }).fetch;
  globalThis.fetch = current;
  delete globalAny[INSTALLED_FLAG];
}

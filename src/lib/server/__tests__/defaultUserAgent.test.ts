import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_USER_AGENT,
  createFetchWithDefaultUserAgent,
  installDefaultUserAgentFetch
} from "@/lib/server/defaultUserAgent";

/** Reads the User-Agent the wrapper passed to the underlying fetch. */
function uaOf(init?: RequestInit): string | null {
  return new Headers(init?.headers).get("user-agent");
}

describe("createFetchWithDefaultUserAgent", () => {
  it("injects the default User-Agent when none is provided (no init)", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    const wrapped = createFetchWithDefaultUserAgent(base);

    await wrapped("https://cards.scryfall.io/a.jpg");

    const [, init] = base.mock.calls[0];
    expect(uaOf(init)).toBe(DEFAULT_USER_AGENT);
  });

  it("injects the default User-Agent while preserving existing headers", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    const wrapped = createFetchWithDefaultUserAgent(base);

    await wrapped("https://cards.scryfall.io/a.jpg", { headers: { Accept: "image/avif" } });

    const [, init] = base.mock.calls[0];
    expect(uaOf(init)).toBe(DEFAULT_USER_AGENT);
    expect(new Headers(init.headers).get("accept")).toBe("image/avif");
  });

  it("uses a custom User-Agent when supplied", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    const wrapped = createFetchWithDefaultUserAgent(base, "my-app/9.9");

    await wrapped("https://cards.scryfall.io/a.jpg");

    expect(uaOf(base.mock.calls[0][1])).toBe("my-app/9.9");
  });

  it("does not override a User-Agent set via a plain headers object (case-insensitive)", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    const wrapped = createFetchWithDefaultUserAgent(base);

    await wrapped("https://x", { headers: { "user-agent": "caller/1.0" } });

    // Caller's init is passed through untouched.
    expect(uaOf(base.mock.calls[0][1])).toBe("caller/1.0");
  });

  it("does not override a User-Agent set via a Headers instance", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    const wrapped = createFetchWithDefaultUserAgent(base);

    await wrapped("https://x", { headers: new Headers({ "User-Agent": "caller/1.0" }) });

    expect(uaOf(base.mock.calls[0][1])).toBe("caller/1.0");
  });

  it("does not override a User-Agent set via a header tuple array", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    const wrapped = createFetchWithDefaultUserAgent(base);

    await wrapped("https://x", { headers: [["User-Agent", "caller/1.0"]] });

    expect(uaOf(base.mock.calls[0][1])).toBe("caller/1.0");
  });

  it("does not override a User-Agent carried on a Request input", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    const wrapped = createFetchWithDefaultUserAgent(base);
    const req = new Request("https://x", { headers: { "User-Agent": "caller/1.0" } });

    await wrapped(req);

    // Passed straight through; the Request still owns the UA.
    expect(base.mock.calls[0][0]).toBe(req);
    expect(req.headers.get("user-agent")).toBe("caller/1.0");
  });

  it("forwards the original input and init to the base fetch", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    const wrapped = createFetchWithDefaultUserAgent(base);

    await wrapped("https://x", { method: "POST", body: "hi" });

    const [input, init] = base.mock.calls[0];
    expect(input).toBe("https://x");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("hi");
  });
});

describe("installDefaultUserAgentFetch", () => {
  it("patches global fetch once and is idempotent", async () => {
    const original = globalThis.fetch;
    try {
      const base = vi.fn().mockResolvedValue(new Response("ok"));
      globalThis.fetch = base as typeof fetch;

      installDefaultUserAgentFetch();
      const afterFirst = globalThis.fetch;
      expect(afterFirst).not.toBe(base);

      // Second call is a no-op (does not re-wrap).
      installDefaultUserAgentFetch();
      expect(globalThis.fetch).toBe(afterFirst);

      await globalThis.fetch("https://cards.scryfall.io/a.jpg");
      expect(uaOf(base.mock.calls[0][1])).toBe(DEFAULT_USER_AGENT);
    } finally {
      globalThis.fetch = original;
    }
  });
});

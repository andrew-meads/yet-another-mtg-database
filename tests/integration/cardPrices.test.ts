import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/cards/prices/route";
import { POST as refresh } from "@/app/api/cards/prices/refresh/route";
import { CardData } from "@/db/schema";
import { applyCardPrices, EMPTY_PRICES } from "@/lib/server/cardPrices";
import { jsonRequest, seedCard, seedCardPrices, seedUser, setTestUser } from "./helpers";
import { clearTcgcsvCaches } from "@/lib/server/priceSources/tcgplayer";
import { clearManapoolCache } from "@/lib/server/priceSources/manapool";
import { PATCH as patchSettings } from "@/app/api/settings/route";
import "./setup";

// scryfallFetch builds `${SCRYFALL_API_BASE_URL}/cards/collection`; the values are
// irrelevant since fetch is mocked, but must be set so the URLs are well-formed.
beforeAll(() => {
  process.env.SCRYFALL_API_BASE_URL = "https://api.scryfall.test";
  process.env.TCGCSV_BASE_URL = "https://tcgcsv.test";
  process.env.MANAPOOL_API_BASE_URL = "https://manapool.test";
});

// The routes read the requesting user's source order; every test runs as a
// fresh user with the default order (Scryfall → TCGplayer → Mana Pool) unless
// it patches its settings.
beforeEach(async () => {
  setTestUser(await seedUser());
  clearTcgcsvCaches();
  clearManapoolCache();
});

/** A Scryfall /cards/collection List response for the given card->usd pairs. */
function collectionResponse(cards: Array<{ id: string; usd: string }>) {
  return Response.json({
    object: "list",
    not_found: [],
    data: cards.map(({ id, usd }) => ({ id, prices: { usd, eur: null } }))
  });
}

let fetchMock: ReturnType<typeof vi.spyOn>;

afterEach(() => {
  fetchMock?.mockRestore();
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/**
 * Mock `fetch` by URL substring: the first matching handler answers; anything
 * unmatched gets a 404 so the corresponding source fails cleanly and the chain
 * moves on. Returns the list of URLs hit, for call-count assertions.
 */
function mockFetch(handlers: Array<[string, Handler]>): string[] {
  const hits: string[] = [];
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    hits.push(url);
    const match = handlers.find(([needle]) => url.includes(needle));
    return match ? match[1](url, init ?? undefined) : new Response("not found", { status: 404 });
  });
  return hits;
}

/**
 * Scryfall-only mock: the marketplaces answer but know nothing (a set with no
 * TCGplayer group, an empty Mana Pool feed), so only Scryfall can price anything
 * and no source counts as failed.
 */
function mockScryfall(handler: Handler): string[] {
  return mockFetch([
    ["/cards/collection", handler],
    ["/sets/", () => Response.json({ code: "tst", tcgplayer_id: null })],
    ["/api/v1/prices/singles", () => Response.json({ data: [] })]
  ]);
}
const collectionCalls = (hits: string[]) =>
  hits.filter((u) => u.includes("/cards/collection")).length;

const HOUR = 60 * 60 * 1000;

/** The stored price fields of a card, by Scryfall id. */
async function storedPrices(id: string) {
  return CardData.findOne({ id }, { _id: 0, prices: 1, prices_updated_at: 1 }).lean();
}

describe("POST /api/cards/prices", () => {
  it("serves prices stamped < 24h ago from the card document without calling Scryfall", async () => {
    await seedCard({ id: "card-a" });
    await seedCardPrices("card-a", { usd: "1.50" }, new Date(Date.now() - HOUR));
    fetchMock = vi.spyOn(globalThis, "fetch");

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-a"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prices["card-a"].usd).toBe("1.50");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports when each price was written, null for cards we hold no price for", async () => {
    const stamp = new Date(Date.now() - HOUR);
    await seedCard({ id: "card-a" });
    await seedCardPrices("card-a", { usd: "1.50" }, stamp);
    fetchMock = vi.spyOn(globalThis, "fetch");

    const res = await POST(
      jsonRequest("/api/cards/prices", "POST", { ids: ["card-a", "not-held"] })
    );
    const body = await res.json();
    expect(body.updatedAt["card-a"]).toBe(stamp.toISOString());
    expect(body.updatedAt["not-held"]).toBeNull();
    expect(body.prices["not-held"]).toEqual(EMPTY_PRICES);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches, writes onto the card, and returns prices for a never-priced card", async () => {
    await seedCard({ id: "card-new" });
    const hits = mockScryfall(() => collectionResponse([{ id: "card-new", usd: "9.99" }]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-new"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prices["card-new"].usd).toBe("9.99");
    expect(body.prices["card-new"].source).toBe("scryfall");
    expect(collectionCalls(hits)).toBe(1);

    // Written onto the card document, stamped now.
    const stored = await storedPrices("card-new");
    expect(stored?.prices?.usd).toBe("9.99");
    expect(Date.now() - new Date(stored!.prices_updated_at!).getTime()).toBeLessThan(HOUR);
  });

  it("refreshes a stale card from Scryfall", async () => {
    await seedCard({ id: "card-old" });
    await seedCardPrices("card-old", { usd: "1.00" }, new Date(Date.now() - 48 * HOUR));
    const hits = mockScryfall(() => collectionResponse([{ id: "card-old", usd: "2.00" }]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-old"] }));
    const body = await res.json();
    expect(body.prices["card-old"].usd).toBe("2.00");
    expect(collectionCalls(hits)).toBe(1);
    expect((await storedPrices("card-old"))?.prices?.usd).toBe("2.00");
  });

  it("batches more than 75 stale ids into multiple Scryfall requests", async () => {
    const ids = Array.from({ length: 76 }, (_, i) => `card-${i}`);
    for (const id of ids) await seedCard({ id });
    // Fresh Response per call: a Response body can only be read once.
    const hits = mockScryfall(() => collectionResponse([]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids }));
    expect(res.status).toBe(200);
    expect(collectionCalls(hits)).toBe(2);
  });

  it("resolves ids we hold no card for to all-null prices without calling Scryfall", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch");

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["unknown"] }));
    const body = await res.json();
    expect(body.prices.unknown).toEqual(EMPTY_PRICES);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stamps all-null prices on a held card no source can price", async () => {
    await seedCard({ id: "card-gone" });
    mockScryfall(() => collectionResponse([]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-gone"] }));
    expect((await res.json()).prices["card-gone"]).toEqual(EMPTY_PRICES);
    const stored = await storedPrices("card-gone");
    expect(stored?.prices_updated_at).toBeTruthy();

    // ...so the next request is served from the document, not upstream.
    fetchMock.mockClear();
    await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-gone"] }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 only when every source fails", async () => {
    await seedCard({ id: "card-x" });
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("boom", { status: 500 }));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-x"] }));
    expect(res.status).toBe(502);
  });

  it("rejects a missing/empty ids array with 400", async () => {
    expect((await POST(jsonRequest("/api/cards/prices", "POST", {}))).status).toBe(400);
    expect((await POST(jsonRequest("/api/cards/prices", "POST", { ids: [] }))).status).toBe(400);
    expect((await POST(jsonRequest("/api/cards/prices", "POST", { ids: [1, 2] }))).status).toBe(
      400
    );
  });

  it("rejects more than 500 ids with 400", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `card-${i}`);
    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids }));
    expect(res.status).toBe(400);
  });
});

describe("applyCardPrices (bulk-import refresh of existing cards)", () => {
  it("overwrites the prices of held cards wholesale and re-stamps them; ignores unheld ids", async () => {
    await seedCard({ id: "card-a" });
    await seedCardPrices(
      "card-a",
      { usd: "1.00", usd_foil: "2.00" },
      new Date(Date.now() - 48 * HOUR)
    );
    await seedCard({ id: "card-b" });

    const written = await applyCardPrices([
      { id: "card-a", prices: { usd: "1.50" } },
      { id: "card-b", prices: { usd: "0.25", eur: "0.20" } },
      { id: "card-nowhere", prices: { usd: "9.00" } }
    ]);
    expect(written).toBe(3);
    expect(await CardData.countDocuments()).toBe(2); // no upsert

    // Overwritten wholesale (the old foil price is gone, not merged) and re-stamped fresh.
    const a = await storedPrices("card-a");
    expect(a!.prices!.usd).toBe("1.50");
    expect(a!.prices!.usd_foil).toBeNull();
    expect(Date.now() - new Date(a!.prices_updated_at!).getTime()).toBeLessThan(HOUR);

    const b = await storedPrices("card-b");
    expect(b!.prices).toMatchObject({ usd: "0.25", eur: "0.20", tix: null });
  });

  it("is a no-op for an empty batch", async () => {
    expect(await applyCardPrices([])).toBe(0);
  });

  it("makes a refreshed card a fresh hit for the prices route", async () => {
    await seedCard({ id: "card-imported" });
    await applyCardPrices([{ id: "card-imported", prices: { usd: "4.00" } }]);
    fetchMock = vi.spyOn(globalThis, "fetch");

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-imported"] }));
    expect((await res.json()).prices["card-imported"].usd).toBe("4.00");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/cards/prices/refresh", () => {
  it("re-fetches from Scryfall even when the price is fresh, overwriting and re-stamping it", async () => {
    const stamp = new Date(Date.now() - 10 * 60_000);
    await seedCard({ id: "card-a" });
    await seedCardPrices("card-a", { usd: "1.00", usd_foil: "2.00" }, stamp);
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(collectionResponse([{ id: "card-a", usd: "1.25" }]));

    const res = await refresh(
      jsonRequest("/api/cards/prices/refresh", "POST", { ids: ["card-a"] })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(body.prices["card-a"].usd).toBe("1.25");
    expect(body.prices["card-a"].usd_foil).toBeNull(); // overwritten wholesale
    expect(new Date(body.updatedAt["card-a"]).getTime()).toBeGreaterThan(stamp.getTime());

    const stored = await storedPrices("card-a");
    expect(stored?.prices?.usd).toBe("1.25");
    expect(new Date(stored!.prices_updated_at!).getTime()).toBeGreaterThan(stamp.getTime());
  });

  it("does not contact Scryfall for ids we hold no card for", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch");
    const res = await refresh(jsonRequest("/api/cards/prices/refresh", "POST", { ids: ["nope"] }));
    const body = await res.json();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.prices.nope).toEqual(EMPTY_PRICES);
    expect(body.updatedAt.nope).toBeNull();
  });

  it("validates the body and caps the id count", async () => {
    expect((await refresh(jsonRequest("/api/cards/prices/refresh", "POST", {}))).status).toBe(400);
    expect(
      (await refresh(jsonRequest("/api/cards/prices/refresh", "POST", { ids: [] }))).status
    ).toBe(400);
    const ids = Array.from({ length: 101 }, (_, i) => `card-${i}`);
    expect((await refresh(jsonRequest("/api/cards/prices/refresh", "POST", { ids }))).status).toBe(
      400
    );
  });

  it("returns 502 when every source fails", async () => {
    await seedCard({ id: "card-x" });
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("boom", { status: 500 }));
    const res = await refresh(
      jsonRequest("/api/cards/prices/refresh", "POST", { ids: ["card-x"] })
    );
    expect(res.status).toBe(502);
  });
});

describe("price source chain", () => {
  /** A Scryfall / TCGCSV / Mana Pool world; "down" makes that source fail. */
  function mockAllSources(opts: {
    scryfallUsd?: string | null;
    tcgUsd?: number | "down";
    manapoolCents?: number | "down";
  }) {
    return mockFetch([
      [
        "/cards/collection",
        () =>
          opts.scryfallUsd === undefined
            ? new Response("down", { status: 503 })
            : collectionResponse(
                opts.scryfallUsd === null ? [] : [{ id: "card-a", usd: opts.scryfallUsd }]
              )
      ],
      ["/sets/", () => Response.json({ code: "tst", tcgplayer_id: 4242 })],
      [
        "/tcgplayer/1/4242/prices",
        () =>
          opts.tcgUsd === "down"
            ? new Response("down", { status: 503 })
            : Response.json({
                success: true,
                results:
                  opts.tcgUsd === undefined
                    ? []
                    : [
                        {
                          productId: 777,
                          subTypeName: "Normal",
                          marketPrice: opts.tcgUsd,
                          midPrice: null,
                          lowPrice: null
                        }
                      ]
              })
      ],
      [
        "/api/v1/prices/singles",
        () =>
          opts.manapoolCents === "down"
            ? new Response("down", { status: 503 })
            : Response.json({
                data:
                  opts.manapoolCents === undefined
                    ? []
                    : [{ scryfall_id: "card-a", price_market: opts.manapoolCents }]
              })
      ]
    ]);
  }

  it("falls through to TCGplayer when Scryfall is down, recording the source", async () => {
    await seedCard({ id: "card-a", tcgplayer_id: 777 });
    const hits = mockAllSources({ tcgUsd: 4.99, manapoolCents: 283 });

    const res = await refresh(
      jsonRequest("/api/cards/prices/refresh", "POST", { ids: ["card-a"] })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prices["card-a"]).toMatchObject({ usd: "4.99", source: "tcgplayer" });
    expect((await storedPrices("card-a"))?.prices?.source).toBe("tcgplayer");
    // Mana Pool was never needed.
    expect(hits.some((u) => u.includes("/api/v1/prices/singles"))).toBe(false);
  });

  it("keeps walking past Scryfall when it only has a EUR price (Unlimited Black Lotus)", async () => {
    await seedCard({ id: "card-a", tcgplayer_id: 777 });
    mockFetch([
      [
        "/cards/collection",
        () =>
          Response.json({
            object: "list",
            not_found: [],
            data: [{ id: "card-a", prices: { usd: null, eur: "11658.96" } }]
          })
      ],
      ["/sets/", () => Response.json({ code: "tst", tcgplayer_id: 4242 })],
      [
        "/tcgplayer/1/4242/prices",
        () =>
          Response.json({
            success: true,
            results: [
              {
                productId: 777,
                subTypeName: "Normal",
                marketPrice: 9000,
                midPrice: null,
                lowPrice: null
              }
            ]
          })
      ],
      ["/api/v1/prices/singles", () => Response.json({ data: [] })]
    ]);

    const res = await refresh(
      jsonRequest("/api/cards/prices/refresh", "POST", { ids: ["card-a"] })
    );
    const body = await res.json();
    expect(body.prices["card-a"]).toMatchObject({ usd: "9000.00", source: "tcgplayer" });
  });

  it("keeps walking when a source answers but has no price for the card", async () => {
    await seedCard({ id: "card-a", tcgplayer_id: 777 });
    mockAllSources({ scryfallUsd: null, manapoolCents: 283 }); // Scryfall: not found; TCGCSV: no row

    const res = await refresh(
      jsonRequest("/api/cards/prices/refresh", "POST", { ids: ["card-a"] })
    );
    const body = await res.json();
    expect(body.prices["card-a"]).toMatchObject({ usd: "2.83", source: "manapool" });
  });

  it("honours the user's priority order and skips disabled sources", async () => {
    await seedCard({ id: "card-a", tcgplayer_id: 777 });
    await patchSettings(
      jsonRequest("/api/settings", "PATCH", {
        pricing: {
          currency: "USD",
          sources: [
            { id: "manapool", enabled: true },
            { id: "scryfall", enabled: false },
            { id: "tcgplayer", enabled: true }
          ]
        }
      })
    );
    const hits = mockAllSources({ scryfallUsd: "1.00", tcgUsd: 4.99, manapoolCents: 283 });

    const res = await refresh(
      jsonRequest("/api/cards/prices/refresh", "POST", { ids: ["card-a"] })
    );
    const body = await res.json();
    expect(body.prices["card-a"]).toMatchObject({ usd: "2.83", source: "manapool" });
    expect(collectionCalls(hits)).toBe(0);
  });

  it("does not record 'no price' for a card while a source is down; keeps the old quote", async () => {
    const stamp = new Date(Date.now() - 48 * HOUR);
    await seedCard({ id: "card-a", tcgplayer_id: 777 });
    await seedCardPrices("card-a", { usd: "1.00" }, stamp);
    await seedCard({ id: "card-b" });
    await seedCardPrices("card-b", { usd: "5.00" }, stamp);
    // Scryfall prices card-b only; TCGCSV is down (it might have priced card-a).
    mockFetch([
      ["/cards/collection", () => collectionResponse([{ id: "card-b", usd: "5.50" }])],
      ["/sets/", () => Response.json({ code: "tst", tcgplayer_id: 4242 })],
      ["/tcgplayer/1/4242/prices", () => new Response("down", { status: 503 })],
      ["/api/v1/prices/singles", () => Response.json({ data: [] })]
    ]);

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-a", "card-b"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prices["card-b"].usd).toBe("5.50");
    // card-a keeps its stale price and stamp instead of being stamped "unpriced".
    expect(body.prices["card-a"].usd).toBe("1.00");
    expect(body.updatedAt["card-a"]).toBe(stamp.toISOString());
    expect((await storedPrices("card-a"))?.prices?.usd).toBe("1.00");
  });

  it("a fresh pre-existing price with no source reads back as-is (source absent = Scryfall)", async () => {
    await seedCard({ id: "card-a" });
    await seedCardPrices("card-a", { usd: "1.00" });
    fetchMock = vi.spyOn(globalThis, "fetch");
    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-a"] }));
    const body = await res.json();
    expect(body.prices["card-a"]).not.toHaveProperty("source");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

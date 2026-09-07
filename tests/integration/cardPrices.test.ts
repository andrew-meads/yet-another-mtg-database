import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { POST } from "@/app/api/cards/prices/route";
import { CardData } from "@/db/schema";
import { applyCardPrices, EMPTY_PRICES } from "@/lib/server/cardPrices";
import { jsonRequest, seedCard, seedCardPrices } from "./helpers";
import "./setup";

// scryfallFetch builds `${SCRYFALL_API_BASE_URL}/cards/collection`; the value is
// irrelevant since fetch is mocked, but must be set so the URL is well-formed.
beforeAll(() => {
  process.env.SCRYFALL_API_BASE_URL = "https://api.scryfall.test";
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

  it("fetches, writes onto the card, and returns prices for a never-priced card", async () => {
    await seedCard({ id: "card-new" });
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(collectionResponse([{ id: "card-new", usd: "9.99" }]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-new"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prices["card-new"].usd).toBe("9.99");
    expect(fetchMock).toHaveBeenCalledOnce();

    // Written onto the card document, stamped now.
    const stored = await storedPrices("card-new");
    expect(stored?.prices?.usd).toBe("9.99");
    expect(Date.now() - new Date(stored!.prices_updated_at!).getTime()).toBeLessThan(HOUR);
  });

  it("refreshes a stale card from Scryfall", async () => {
    await seedCard({ id: "card-old" });
    await seedCardPrices("card-old", { usd: "1.00" }, new Date(Date.now() - 48 * HOUR));
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(collectionResponse([{ id: "card-old", usd: "2.00" }]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-old"] }));
    const body = await res.json();
    expect(body.prices["card-old"].usd).toBe("2.00");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await storedPrices("card-old"))?.prices?.usd).toBe("2.00");
  });

  it("batches more than 75 stale ids into multiple Scryfall requests", async () => {
    const ids = Array.from({ length: 76 }, (_, i) => `card-${i}`);
    for (const id of ids) await seedCard({ id });
    // Fresh Response per call: a Response body can only be read once.
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => collectionResponse([]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resolves ids we hold no card for to all-null prices without calling Scryfall", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch");

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["unknown"] }));
    const body = await res.json();
    expect(body.prices.unknown).toEqual(EMPTY_PRICES);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stamps all-null prices on a held card Scryfall no longer returns", async () => {
    await seedCard({ id: "card-gone" });
    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(collectionResponse([]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-gone"] }));
    expect((await res.json()).prices["card-gone"]).toEqual(EMPTY_PRICES);
    const stored = await storedPrices("card-gone");
    expect(stored?.prices_updated_at).toBeTruthy();

    // ...so the next request is served from the document, not Scryfall.
    fetchMock.mockClear();
    await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-gone"] }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when Scryfall fails", async () => {
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

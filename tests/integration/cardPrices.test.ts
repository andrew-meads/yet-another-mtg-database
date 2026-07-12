import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { POST } from "@/app/api/cards/prices/route";
import { CardPriceModel } from "@/db/schema";
import { jsonRequest, seedCardPrice } from "./helpers";
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

describe("POST /api/cards/prices", () => {
  it("serves a fresh cache hit without calling Scryfall", async () => {
    await seedCardPrice("card-a", { usd: "1.50" }, new Date(Date.now() - HOUR));
    fetchMock = vi.spyOn(globalThis, "fetch");

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-a"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prices["card-a"].usd).toBe("1.50");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches, upserts, and returns prices for a missing card", async () => {
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(collectionResponse([{ id: "card-new", usd: "9.99" }]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-new"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prices["card-new"].usd).toBe("9.99");
    expect(fetchMock).toHaveBeenCalledOnce();

    // Upserted into the cache.
    const cached = await CardPriceModel.findOne({ cardId: "card-new" });
    expect(cached?.prices.usd).toBe("9.99");
  });

  it("refreshes a stale cached card from Scryfall", async () => {
    await seedCardPrice("card-old", { usd: "1.00" }, new Date(Date.now() - 48 * HOUR));
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(collectionResponse([{ id: "card-old", usd: "2.00" }]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-old"] }));
    const body = await res.json();
    expect(body.prices["card-old"].usd).toBe("2.00");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("batches more than 75 ids into multiple Scryfall requests", async () => {
    const ids = Array.from({ length: 76 }, (_, i) => `card-${i}`);
    // Fresh Response per call: a Response body can only be read once.
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => collectionResponse([]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns all-null prices for a card Scryfall does not know", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(collectionResponse([]));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["unknown"] }));
    const body = await res.json();
    expect(body.prices.unknown).toEqual({
      usd: null,
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null
    });
  });

  it("returns 502 when Scryfall fails", async () => {
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("boom", { status: 500 }));

    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids: ["card-x"] }));
    expect(res.status).toBe(502);
  });

  it("rejects a missing/empty ids array with 400", async () => {
    expect((await POST(jsonRequest("/api/cards/prices", "POST", {}))).status).toBe(400);
    expect((await POST(jsonRequest("/api/cards/prices", "POST", { ids: [] }))).status).toBe(400);
    expect(
      (await POST(jsonRequest("/api/cards/prices", "POST", { ids: [1, 2] }))).status
    ).toBe(400);
  });

  it("rejects more than 500 ids with 400", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `card-${i}`);
    const res = await POST(jsonRequest("/api/cards/prices", "POST", { ids }));
    expect(res.status).toBe(400);
  });
});

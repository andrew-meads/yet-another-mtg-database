import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { POST as refreshCopies } from "@/app/api/physical-cards/prices/refresh/route";
import { GET as getCollection } from "@/app/api/collections/[id]/route";
import { PATCH as patchSettings } from "@/app/api/settings/route";
import { PhysicalCardModel } from "@/db/schema";
import { clearManapoolCache } from "@/lib/server/priceSources/manapool";
import { clearTcgcsvCaches } from "@/lib/server/priceSources/tcgplayer";
import {
  ctx,
  jsonRequest,
  seedCard,
  seedCollection,
  seedPhysicalCard,
  seedUser,
  setTestUser
} from "./helpers";
import "./setup";

beforeAll(() => {
  process.env.SCRYFALL_API_BASE_URL = "https://api.scryfall.test";
  process.env.TCGCSV_BASE_URL = "https://tcgcsv.test";
  process.env.MANAPOOL_API_BASE_URL = "https://manapool.test";
});

let owner: string;
let collectionId: string;
let fetchMock: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(async () => {
  owner = await seedUser();
  setTestUser(owner);
  collectionId = await seedCollection(owner);
  clearManapoolCache();
  clearTcgcsvCaches();
});
afterEach(() => fetchMock?.mockRestore());

/** Scryfall: $1.50 non-foil / $4.00 foil; no TCGplayer group; Mana Pool with condition tiers. */
function mockSources(opts: { manapool?: boolean; scryfall?: boolean } = {}) {
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/cards/collection")) {
      if (opts.scryfall === false) return new Response("down", { status: 503 });
      return Response.json({
        object: "list",
        not_found: [],
        data: [{ id: "card-a", prices: { usd: "1.50", usd_foil: "4.00" } }]
      });
    }
    if (url.includes("/sets/")) return Response.json({ code: "tst", tcgplayer_id: null });
    if (url.includes("/api/v1/prices/singles")) {
      if (opts.manapool === false) return new Response("down", { status: 503 });
      return Response.json({
        data: [
          {
            scryfall_id: "card-a",
            price_cents: 100,
            price_cents_lp_plus: 120,
            price_cents_nm: 140,
            price_market: 150,
            price_cents_foil: 300,
            price_cents_lp_plus_foil: 350,
            price_cents_nm_foil: null,
            price_market_foil: 400
          }
        ]
      });
    }
    return new Response("not found", { status: 404 });
  });
}

const refresh = (ids: string[]) =>
  refreshCopies(
    jsonRequest("/api/physical-cards/prices/refresh", "POST", { physicalCardIds: ids })
  );

describe("POST /api/physical-cards/prices/refresh", () => {
  it("prices each copy for its own finish and condition and stores the record on the copy", async () => {
    await seedCard({ id: "card-a" });
    const nm = await seedPhysicalCard(owner, "card-a", collectionId);
    const lpFoil = await seedPhysicalCard(owner, "card-a", collectionId, {
      finish: "foil",
      condition: "LP"
    });
    mockSources();

    const res = await refresh([nm, lpFoil]);
    expect(res.status).toBe(200);
    const body = await res.json();
    // NM non-foil: Scryfall is first in the default order and matches NM.
    expect(body.prices[nm]).toMatchObject({
      usd: "1.50",
      source: "scryfall",
      finish: "nonfoil",
      condition: "NM",
      conditionMatched: true
    });
    // LP foil: Scryfall only has a finish-level price (unmatched); Mana Pool's LP+ foil tier wins.
    expect(body.prices[lpFoil]).toMatchObject({
      usd: "3.50",
      source: "manapool",
      finish: "foil",
      condition: "LP",
      conditionMatched: true
    });
    expect(body.unknown).toEqual([]);

    const stored = await PhysicalCardModel.findById(lpFoil).lean();
    expect(stored?.price).toMatchObject({
      usd: "3.50",
      source: "manapool",
      conditionMatched: true
    });
    expect(stored?.price?.updatedAt).toBeInstanceOf(Date);
  });

  it("uses the finish-level price, flagged unmatched, when no source has the condition tier", async () => {
    await seedCard({ id: "card-a" });
    const mp = await seedPhysicalCard(owner, "card-a", collectionId, { condition: "MP" });
    mockSources({ manapool: false });

    const body = await (await refresh([mp])).json();
    expect(body.prices[mp]).toMatchObject({
      usd: "1.50",
      source: "scryfall",
      conditionMatched: false
    });
  });

  it("surfaces the copy's price through the collection details", async () => {
    await seedCard({ id: "card-a" });
    const id = await seedPhysicalCard(owner, "card-a", collectionId, { finish: "foil" });
    mockSources();
    await refresh([id]);

    const res = await getCollection(
      jsonRequest(`/api/collections/${collectionId}?details=true`, "GET"),
      ctx({ id: collectionId })
    );
    const body = await res.json();
    const entry = body.collection.cards.find((c: { _id: string }) => c._id === id);
    expect(entry.price).toMatchObject({ usd: "4.00", finish: "foil", condition: "NM" });
  });

  it("ignores other users' copies and unknown ids", async () => {
    await seedCard({ id: "card-a" });
    const other = await seedUser("other@example.com");
    const otherColl = await seedCollection(other);
    const theirs = await seedPhysicalCard(other, "card-a", otherColl);
    const mine = await seedPhysicalCard(owner, "card-a", collectionId);
    mockSources();

    const body = await (await refresh([mine, theirs, "not-an-id"])).json();
    expect(Object.keys(body.prices)).toEqual([mine]);
    expect(body.unknown.sort()).toEqual([theirs, "not-an-id"].sort());
    expect((await PhysicalCardModel.findById(theirs).lean())?.price).toBeUndefined();
  });

  it("stores a null price when every source answered but none priced the copy", async () => {
    await seedCard({ id: "card-b" }); // no source knows card-b
    const id = await seedPhysicalCard(owner, "card-b", collectionId);
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/cards/collection"))
        return Response.json({ object: "list", not_found: [], data: [] });
      if (url.includes("/sets/")) return Response.json({ code: "tst", tcgplayer_id: null });
      return Response.json({ data: [] });
    });
    const body = await (await refresh([id])).json();
    expect(body.prices[id]).toMatchObject({ usd: null, conditionMatched: false });
    expect((await PhysicalCardModel.findById(id).lean())?.price?.usd).toBeNull();
  });

  it("leaves a copy untouched when a source is down and nothing priced it", async () => {
    await seedCard({ id: "card-a" });
    const id = await seedPhysicalCard(owner, "card-a", collectionId);
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("down", { status: 503 }));
    const res = await refresh([id]);
    expect(res.status).toBe(502);
    expect((await PhysicalCardModel.findById(id).lean())?.price).toBeUndefined();
  });

  it("honours the user's source order", async () => {
    await seedCard({ id: "card-a" });
    const nm = await seedPhysicalCard(owner, "card-a", collectionId);
    await patchSettings(
      jsonRequest("/api/settings", "PATCH", {
        pricing: {
          currency: "USD",
          sources: [
            { id: "manapool", enabled: true },
            { id: "scryfall", enabled: true },
            { id: "tcgplayer", enabled: false }
          ]
        }
      })
    );
    mockSources();
    const body = await (await refresh([nm])).json();
    expect(body.prices[nm]).toMatchObject({
      usd: "1.40",
      source: "manapool",
      conditionMatched: true
    });
  });

  it("never prices a copy tagged Proxy (no source is consulted, nothing is stored)", async () => {
    await seedCard({ id: "card-a" });
    const proxy = await seedPhysicalCard(owner, "card-a", collectionId, {
      tags: ["staple", "proxy"]
    });
    const real = await seedPhysicalCard(owner, "card-a", collectionId);
    mockSources();

    const body = await (await refresh([proxy, real])).json();
    expect(Object.keys(body.prices)).toEqual([real]);
    expect(body.proxies).toEqual([proxy]);
    expect((await PhysicalCardModel.findById(proxy).lean())?.price).toBeUndefined();

    // A proxy-only refresh touches no source at all.
    fetchMock!.mockClear();
    const only = await (await refresh([proxy])).json();
    expect(only).toEqual({ prices: {}, unknown: [], proxies: [proxy] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    expect(
      (await refreshCopies(jsonRequest("/api/physical-cards/prices/refresh", "POST", {}))).status
    ).toBe(400);
    expect((await refresh([])).status).toBe(400);
    expect((await refresh(Array.from({ length: 101 }, (_, i) => `id${i}`))).status).toBe(400);
  });
});

import { describe, it, expect } from "vitest";
import {
  buildPriceUpdates,
  chunk,
  extractPrices,
  isFresh,
  EMPTY_PRICES,
  PRICE_STALENESS_MS
} from "@/lib/server/cardPrices";

describe("extractPrices", () => {
  it("picks the six finish fields off a Scryfall card", () => {
    const card = {
      id: "x",
      prices: {
        usd: "1.23",
        usd_foil: "4.56",
        usd_etched: "7.89",
        eur: "1.00",
        eur_foil: "2.00",
        tix: "0.03"
      }
    };
    expect(extractPrices(card)).toEqual(card.prices);
  });

  it("defaults missing finishes to null", () => {
    expect(extractPrices({ prices: { usd: "1.00" } })).toEqual({
      ...EMPTY_PRICES,
      usd: "1.00"
    });
  });

  it("returns all-null when prices is absent or null", () => {
    expect(extractPrices({})).toEqual(EMPTY_PRICES);
    expect(extractPrices({ prices: null })).toEqual(EMPTY_PRICES);
  });
});

describe("buildPriceUpdates", () => {
  const now = new Date("2026-09-08T00:00:00Z");

  it("builds one non-upserting update per card with the extracted prices and a stamp", () => {
    const ops = buildPriceUpdates(
      [
        { id: "a", prices: { usd: "1.00", usd_foil: "2.00" } },
        { id: "b", prices: null }
      ],
      now
    );
    expect(ops).toEqual([
      {
        updateOne: {
          filter: { id: "a" },
          update: {
            $set: {
              prices: { ...EMPTY_PRICES, usd: "1.00", usd_foil: "2.00" },
              prices_updated_at: now
            }
          }
        }
      },
      {
        updateOne: {
          filter: { id: "b" },
          update: { $set: { prices: EMPTY_PRICES, prices_updated_at: now } }
        }
      }
    ]);
    expect(ops[0].updateOne).not.toHaveProperty("upsert");
  });

  it("dedupes by id, last one winning, and skips entries without an id", () => {
    const ops = buildPriceUpdates(
      [
        { id: "a", prices: { usd: "1.00" } },
        { id: "", prices: { usd: "5.00" } },
        { id: "a", prices: { usd: "3.00" } }
      ],
      now
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update.$set.prices.usd).toBe("3.00");
  });

  it("returns [] for no cards", () => {
    expect(buildPriceUpdates([], now)).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits into consecutive chunks of at most size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when smaller than size", () => {
    expect(chunk([1, 2], 75)).toEqual([[1, 2]]);
  });

  it("returns [] for an empty array", () => {
    expect(chunk([], 75)).toEqual([]);
  });
});

describe("isFresh", () => {
  const now = 1_000_000_000_000;

  it("is false for undefined / null", () => {
    expect(isFresh(undefined, now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(isFresh(new Date(now - 1000).toISOString(), now)).toBe(true);
  });

  it("is true just inside the window", () => {
    expect(isFresh(new Date(now - (PRICE_STALENESS_MS - 1)), now)).toBe(true);
  });

  it("is false at/after the window", () => {
    expect(isFresh(new Date(now - PRICE_STALENESS_MS), now)).toBe(false);
    expect(isFresh(new Date(now - PRICE_STALENESS_MS - 1), now)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  PRICE_AGING_MS,
  PRICE_FRESH_MS,
  bestUsd,
  convertUsd,
  formatAge,
  formatMoney,
  isSupportedCurrency,
  oldestStamp,
  parsePrice,
  priceAge,
  totalUsd,
  usdForFinish
} from "@/lib/pricing";
import { CardPrices } from "@/types/CardPrice";

const prices: CardPrices = {
  usd: "1.50",
  usd_foil: "4.00",
  usd_etched: null,
  eur: "1.20",
  eur_foil: null,
  tix: "0.02"
};

describe("parsePrice / usdForFinish / bestUsd", () => {
  it("parses decimal strings and rejects null/blank/garbage", () => {
    expect(parsePrice("1.50")).toBe(1.5);
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
  });

  it("picks the finish-specific USD price, treating unset finish as non-foil", () => {
    expect(usdForFinish(prices, undefined)).toBe(1.5);
    expect(usdForFinish(prices, "nonfoil")).toBe(1.5);
    expect(usdForFinish(prices, "foil")).toBe(4);
    expect(usdForFinish(prices, "etched")).toBeNull();
    expect(usdForFinish(null, "foil")).toBeNull();
  });

  it("bestUsd prefers non-foil, then foil, then etched, and reports which", () => {
    expect(bestUsd(prices)).toEqual({ amount: 1.5, finish: "nonfoil" });
    expect(bestUsd({ ...prices, usd: null })).toEqual({ amount: 4, finish: "foil" });
    expect(bestUsd({ ...prices, usd: null, usd_foil: null, usd_etched: "9.99" })).toEqual({
      amount: 9.99,
      finish: "etched"
    });
    expect(bestUsd({ ...prices, usd: null, usd_foil: null })).toBeNull();
    expect(bestUsd(undefined)).toBeNull();
  });
});

describe("currency", () => {
  it("converts with a rate and formats in the target currency", () => {
    expect(convertUsd(2, 1.6)).toBeCloseTo(3.2);
    expect(formatMoney(12.5, "USD", "en-US")).toBe("$12.50");
    expect(formatMoney(1234.5, "EUR", "en-US")).toBe("€1,234.50");
  });

  it("falls back to a plain code suffix for a currency Intl rejects", () => {
    expect(formatMoney(3, "NOPE!", "en-US")).toBe("3.00 NOPE!");
  });

  it("knows the supported currency list", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("NZD")).toBe(true);
    expect(isSupportedCurrency("usd")).toBe(false);
    expect(isSupportedCurrency("XXX")).toBe(false);
    expect(isSupportedCurrency(3)).toBe(false);
  });
});

describe("price age", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");

  it("grades fresh / aging / stale / unknown", () => {
    expect(priceAge(new Date(now - 60_000), now).level).toBe("fresh");
    expect(priceAge(new Date(now - PRICE_FRESH_MS + 1), now).level).toBe("fresh");
    expect(priceAge(new Date(now - PRICE_FRESH_MS), now).level).toBe("aging");
    expect(priceAge(new Date(now - PRICE_AGING_MS - 1), now).level).toBe("stale");
    expect(priceAge(null, now)).toEqual({ level: "unknown", ageMs: null, label: "unknown" });
    expect(priceAge("not a date", now).level).toBe("unknown");
  });

  it("accepts ISO strings and never reports a negative age", () => {
    const age = priceAge(new Date(now + 60_000).toISOString(), now);
    expect(age.ageMs).toBe(0);
    expect(age.label).toBe("just now");
  });

  it("humanizes ages coarsely", () => {
    expect(formatAge(30_000)).toBe("just now");
    expect(formatAge(60_000)).toBe("1 minute ago");
    expect(formatAge(5 * 60_000)).toBe("5 minutes ago");
    expect(formatAge(3 * 3_600_000)).toBe("3 hours ago");
    expect(formatAge(2 * 86_400_000)).toBe("2 days ago");
    expect(formatAge(65 * 86_400_000)).toBe("2 months ago");
  });

  it("oldestStamp picks the earliest known stamp", () => {
    expect(oldestStamp([])).toBeNull();
    expect(oldestStamp([null, undefined])).toBeNull();
    expect(
      oldestStamp(["2026-09-08T00:00:00.000Z", null, new Date("2026-09-01T00:00:00.000Z")])
    ).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("totalUsd", () => {
  it("sums quantity × finish price and counts unpriced and estimated copies", () => {
    expect(
      totalUsd([
        { prices, finish: "nonfoil", quantity: 2 },
        { prices, finish: "foil", quantity: 1 },
        { prices, finish: "etched", quantity: 3 },
        { prices: null, quantity: 1 }
      ])
    ).toEqual({ usd: 7, unpriced: 4, estimated: 7 });
  });

  it("uses an explicit per-copy unit price when present (null = fetched but unpriced)", () => {
    expect(
      totalUsd([
        { unitUsd: 2.5, prices, finish: "nonfoil", quantity: 2 }, // copy price beats the printing's
        { unitUsd: null, prices, finish: "foil", quantity: 1 }, // fetched, no price
        { prices, finish: "nonfoil", quantity: 1 } // estimated from the printing
      ])
    ).toEqual({ usd: 6.5, unpriced: 1, estimated: 1 });
  });
});

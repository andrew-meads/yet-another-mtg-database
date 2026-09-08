import { describe, it, expect } from "vitest";
import { indexTcgcsvPrices, pricesFromTcgcsv } from "../tcgplayer";
import {
  copyPriceFromManapoolEntry,
  indexManapoolFeed,
  pricesFromManapoolEntry
} from "../manapool";
import { extractPrices } from "../scryfall";
import { centsToDollars, dollars, hasAnyPrice, hasUsdPrice, EMPTY_PRICES } from "../types";

describe("helpers", () => {
  it("formats dollars and cents like Scryfall strings", () => {
    expect(dollars(4.99)).toBe("4.99");
    expect(dollars(5)).toBe("5.00");
    expect(dollars(null)).toBeNull();
    expect(dollars(NaN)).toBeNull();
    expect(centsToDollars(283)).toBe("2.83");
    expect(centsToDollars(undefined)).toBeNull();
    expect(hasAnyPrice(EMPTY_PRICES)).toBe(false);
    expect(hasAnyPrice({ ...EMPTY_PRICES, tix: "0.02" })).toBe(true);
    expect(hasUsdPrice({ ...EMPTY_PRICES, eur: "5.00", tix: "0.02" })).toBe(false);
    expect(hasUsdPrice({ ...EMPTY_PRICES, usd_etched: "5.00" })).toBe(true);
  });

  it("extractPrices carries a stored source through and omits it when absent", () => {
    expect(extractPrices({ prices: { usd: "1.00", source: "manapool" } })).toEqual({
      ...EMPTY_PRICES,
      usd: "1.00",
      source: "manapool"
    });
    expect(extractPrices({ prices: { usd: "1.00" } })).not.toHaveProperty("source");
  });
});

describe("TCGplayer (TCGCSV) mapping", () => {
  const index = indexTcgcsvPrices([
    { productId: 100, subTypeName: "Normal", marketPrice: 4.99, midPrice: 5.49, lowPrice: 3.8 },
    { productId: 100, subTypeName: "Foil", marketPrice: null, midPrice: 12.5, lowPrice: 9 },
    { productId: 200, subTypeName: "Foil", marketPrice: 30, midPrice: 31, lowPrice: 25 }
  ]);

  it("prices normal and foil from the product id, etched from the etched product", () => {
    expect(pricesFromTcgcsv({ tcgplayer_id: 100, tcgplayer_etched_id: 200 }, index)).toEqual({
      ...EMPTY_PRICES,
      usd: "4.99",
      usd_foil: "12.50", // market missing → mid
      usd_etched: "30.00",
      source: "tcgplayer"
    });
  });

  it("returns null for a card with no priced product", () => {
    expect(pricesFromTcgcsv({ tcgplayer_id: 999 }, index)).toBeNull();
    expect(pricesFromTcgcsv({}, index)).toBeNull();
  });

  it("indexes subtypes case-insensitively and ignores malformed rows", () => {
    const idx = indexTcgcsvPrices([
      { productId: 1, subTypeName: "NORMAL", marketPrice: 1, midPrice: null, lowPrice: null },
      { subTypeName: "Normal" } as never
    ]);
    expect(idx.size).toBe(1);
    expect(pricesFromTcgcsv({ tcgplayer_id: 1 }, idx)?.usd).toBe("1.00");
  });
});

describe("Mana Pool mapping", () => {
  it("prefers market price, then NM, then any-condition, per finish", () => {
    expect(
      pricesFromManapoolEntry({
        scryfall_id: "a",
        price_cents: 244,
        price_cents_nm: 515,
        price_market: 283,
        price_cents_foil: 1937,
        price_cents_nm_foil: null,
        price_market_foil: null,
        price_cents_etched: 1000,
        price_cents_nm_etched: 1200
      })
    ).toEqual({
      ...EMPTY_PRICES,
      usd: "2.83",
      usd_foil: "19.37",
      usd_etched: "12.00",
      source: "manapool"
    });
  });

  it("returns null when the entry has no price at all", () => {
    expect(pricesFromManapoolEntry({ scryfall_id: "a" })).toBeNull();
  });

  it("indexes the feed by scryfall id, later duplicates winning", () => {
    const idx = indexManapoolFeed([
      { scryfall_id: "a", price_cents: 1 },
      { scryfall_id: "a", price_cents: 2 },
      { scryfall_id: 3 as never }
    ]);
    expect(idx.size).toBe(1);
    expect(idx.get("a")?.price_cents).toBe(2);
  });
});

describe("Mana Pool copy pricing by condition", () => {
  const entry = {
    scryfall_id: "a",
    price_cents: 244,
    price_cents_lp_plus: 298,
    price_cents_nm: 515,
    price_market: 283,
    price_cents_foil: 1937,
    price_cents_lp_plus_foil: null,
    price_cents_nm_foil: null,
    price_market_foil: 2500,
    price_cents_etched: null,
    price_cents_lp_plus_etched: null,
    price_cents_nm_etched: null
  };

  it("maps NM → NM tier (or market), LP → LP+ tier, worse → lowest of any condition", () => {
    expect(copyPriceFromManapoolEntry(entry, "nonfoil", "NM")).toEqual({
      usd: "5.15",
      matched: true
    });
    expect(copyPriceFromManapoolEntry(entry, "nonfoil", "LP")).toEqual({
      usd: "2.98",
      matched: true
    });
    expect(copyPriceFromManapoolEntry(entry, "nonfoil", "MP")).toEqual({
      usd: "2.44",
      matched: true
    });
    expect(copyPriceFromManapoolEntry(entry, "nonfoil", "DMG")).toEqual({
      usd: "2.44",
      matched: true
    });
  });

  it("falls back to a finish-level price, flagged unmatched, when the tier has no listing", () => {
    // Foil NM: no NM listing → market price counts as NM.
    expect(copyPriceFromManapoolEntry(entry, "foil", "NM")).toEqual({
      usd: "25.00",
      matched: true
    });
    // Foil LP: no LP+ listing → market, unmatched.
    expect(copyPriceFromManapoolEntry(entry, "foil", "LP")).toEqual({
      usd: "25.00",
      matched: false
    });
    // Etched: nothing at all.
    expect(copyPriceFromManapoolEntry(entry, "etched", "NM")).toBeNull();
  });
});

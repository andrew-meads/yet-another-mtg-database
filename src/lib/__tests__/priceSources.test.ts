import { describe, it, expect } from "vitest";
import {
  DEFAULT_PRICE_SOURCE_PREFERENCES,
  PRICE_SOURCE_IDS,
  PRICE_SOURCES,
  effectivePriceSource,
  enabledSourceOrder,
  isPriceSourceId,
  moveSourcePreference,
  normalizeSourcePreferences,
  priceSourceName
} from "@/lib/priceSources";

describe("price source registry", () => {
  it("describes every id", () => {
    for (const id of PRICE_SOURCE_IDS) expect(PRICE_SOURCES[id].id).toBe(id);
    expect(isPriceSourceId("tcgplayer")).toBe(true);
    expect(isPriceSourceId("cardkingdom")).toBe(false);
  });

  it("defaults to every source enabled, Scryfall first", () => {
    expect(DEFAULT_PRICE_SOURCE_PREFERENCES.map((p) => p.id)).toEqual([
      "scryfall",
      "tcgplayer",
      "manapool"
    ]);
    expect(enabledSourceOrder(DEFAULT_PRICE_SOURCE_PREFERENCES)).toEqual(PRICE_SOURCE_IDS);
  });
});

describe("normalizeSourcePreferences", () => {
  it("yields the defaults for an absent list", () => {
    expect(normalizeSourcePreferences(undefined)).toEqual(DEFAULT_PRICE_SOURCE_PREFERENCES);
    expect(normalizeSourcePreferences(null)).toEqual(DEFAULT_PRICE_SOURCE_PREFERENCES);
  });

  it("keeps the user's order, drops unknown/duplicate ids, and appends missing sources enabled", () => {
    expect(
      normalizeSourcePreferences([
        { id: "manapool", enabled: false },
        { id: "bogus", enabled: true },
        { id: "scryfall", enabled: true },
        { id: "manapool", enabled: true }
      ])
    ).toEqual([
      { id: "manapool", enabled: false },
      { id: "scryfall", enabled: true },
      { id: "tcgplayer", enabled: true }
    ]);
  });

  it("treats a missing enabled flag as enabled", () => {
    expect(normalizeSourcePreferences([{ id: "tcgplayer" }])[0]).toEqual({
      id: "tcgplayer",
      enabled: true
    });
  });
});

describe("enabledSourceOrder / moveSourcePreference", () => {
  const prefs = normalizeSourcePreferences([
    { id: "tcgplayer", enabled: true },
    { id: "scryfall", enabled: false },
    { id: "manapool", enabled: true }
  ]);

  it("skips disabled sources but keeps the order", () => {
    expect(enabledSourceOrder(prefs)).toEqual(["tcgplayer", "manapool"]);
  });

  it("moves an entry up or down and no-ops at the edges", () => {
    expect(moveSourcePreference(prefs, 1, -1).map((p) => p.id)).toEqual([
      "scryfall",
      "tcgplayer",
      "manapool"
    ]);
    expect(moveSourcePreference(prefs, 1, 1).map((p) => p.id)).toEqual([
      "tcgplayer",
      "manapool",
      "scryfall"
    ]);
    expect(moveSourcePreference(prefs, 0, -1)).toBe(prefs);
    expect(moveSourcePreference(prefs, 2, 1)).toBe(prefs);
    expect(moveSourcePreference(prefs, 7, 1)).toBe(prefs);
  });
});

describe("effectivePriceSource", () => {
  it("treats an absent or unknown source as Scryfall", () => {
    expect(effectivePriceSource(undefined)).toBe("scryfall");
    expect(effectivePriceSource({})).toBe("scryfall");
    expect(effectivePriceSource({ source: "weird" })).toBe("scryfall");
    expect(effectivePriceSource({ source: "manapool" })).toBe("manapool");
    expect(priceSourceName({ source: "tcgplayer" })).toBe("TCGplayer");
    expect(priceSourceName(null)).toBe("Scryfall");
  });
});

import { describe, it, expect, vi } from "vitest";
import { copyPriceKey, copyPricesFromAdapter, resolveCopyPrices } from "..";
import { CopyPriceAnswer, EMPTY_PRICES, PriceSourceAdapter, SourceCard } from "../types";

const card: SourceCard = { id: "a", set: "x" };
const key = (finish: "nonfoil" | "foil", condition: "NM" | "LP" | "MP") =>
  copyPriceKey("a", finish, condition);

/** A finish-level-only source (no fetchCopyPrices). */
function finishOnly(
  id: PriceSourceAdapter["id"],
  usd: string | null,
  usdFoil: string | null = null
) {
  return {
    id,
    fetchPrices: vi.fn(async () =>
      usd || usdFoil ? { a: { ...EMPTY_PRICES, usd, usd_foil: usdFoil } } : {}
    )
  } as PriceSourceAdapter;
}
/** A condition-aware source. */
function conditionAware(id: PriceSourceAdapter["id"], answer: CopyPriceAnswer | null) {
  return {
    id,
    fetchPrices: vi.fn(async () => ({})),
    fetchCopyPrices: vi.fn(async () => (answer ? { a: answer } : {}))
  } as PriceSourceAdapter;
}

describe("copyPricesFromAdapter", () => {
  it("derives from finish-level prices, matched only for Near Mint", async () => {
    const src = finishOnly("scryfall", "1.50", "4.00");
    expect(await copyPricesFromAdapter(src, [card], "foil", "NM")).toEqual({
      a: { usd: "4.00", matched: true }
    });
    expect(await copyPricesFromAdapter(src, [card], "nonfoil", "LP")).toEqual({
      a: { usd: "1.50", matched: false }
    });
    expect(
      await copyPricesFromAdapter(finishOnly("scryfall", null), [card], "nonfoil", "NM")
    ).toEqual({});
  });

  it("uses the adapter's own condition pricing when it has one", async () => {
    const src = conditionAware("manapool", { usd: "2.98", matched: true });
    expect(await copyPricesFromAdapter(src, [card], "nonfoil", "LP")).toEqual({
      a: { usd: "2.98", matched: true }
    });
    expect(src.fetchPrices).not.toHaveBeenCalled();
  });
});

describe("resolveCopyPrices", () => {
  it("prefers the first source in order that matched the condition over an earlier unmatched one", async () => {
    const scryfall = finishOnly("scryfall", "1.50");
    const manapool = conditionAware("manapool", { usd: "2.98", matched: true });
    const result = await resolveCopyPrices(
      [{ finish: "nonfoil", condition: "LP", cards: [card] }],
      ["scryfall", "manapool"],
      { scryfall, tcgplayer: finishOnly("tcgplayer", null), manapool }
    );
    expect(result.prices[key("nonfoil", "LP")]).toEqual({
      usd: "2.98",
      matched: true,
      source: "manapool"
    });
  });

  it("stops at the first matched answer (Near Mint copies respect the order fully)", async () => {
    const scryfall = finishOnly("scryfall", "1.50");
    const manapool = conditionAware("manapool", { usd: "5.15", matched: true });
    const result = await resolveCopyPrices(
      [{ finish: "nonfoil", condition: "NM", cards: [card] }],
      ["scryfall", "manapool"],
      { scryfall, tcgplayer: finishOnly("tcgplayer", null), manapool }
    );
    expect(result.prices[key("nonfoil", "NM")]).toEqual({
      usd: "1.50",
      matched: true,
      source: "scryfall"
    });
    expect(manapool.fetchCopyPrices).not.toHaveBeenCalled();
  });

  it("falls back to the first unmatched finish-level answer when no source matched", async () => {
    const result = await resolveCopyPrices(
      [{ finish: "nonfoil", condition: "MP", cards: [card] }],
      ["tcgplayer", "scryfall"],
      {
        scryfall: finishOnly("scryfall", "1.50"),
        tcgplayer: finishOnly("tcgplayer", "1.40"),
        manapool: conditionAware("manapool", null)
      }
    );
    expect(result.prices[key("nonfoil", "MP")]).toEqual({
      usd: "1.40",
      matched: false,
      source: "tcgplayer"
    });
  });

  it("prices each group by its own finish and condition", async () => {
    const manapool = conditionAware("manapool", { usd: "9.99", matched: true });
    const result = await resolveCopyPrices(
      [
        { finish: "nonfoil", condition: "NM", cards: [card] },
        { finish: "foil", condition: "LP", cards: [card] }
      ],
      ["manapool"],
      { scryfall: finishOnly("scryfall", null), tcgplayer: finishOnly("tcgplayer", null), manapool }
    );
    expect(Object.keys(result.prices).sort()).toEqual([key("foil", "LP"), key("nonfoil", "NM")]);
    expect(manapool.fetchCopyPrices).toHaveBeenCalledTimes(2);
  });

  it("skips a failing source, and throws only when a source failed and nothing was priced", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = {
      id: "scryfall",
      fetchPrices: vi.fn(async () => {
        throw new Error("down");
      })
    } as PriceSourceAdapter;
    const ok = await resolveCopyPrices(
      [{ finish: "nonfoil", condition: "NM", cards: [card] }],
      ["scryfall", "tcgplayer"],
      {
        scryfall: boom,
        tcgplayer: finishOnly("tcgplayer", "1.40"),
        manapool: conditionAware("manapool", null)
      }
    );
    expect(ok.prices[key("nonfoil", "NM")]?.source).toBe("tcgplayer");
    expect(ok.failures).toEqual([{ source: "scryfall", error: "down" }]);

    await expect(
      resolveCopyPrices([{ finish: "nonfoil", condition: "NM", cards: [card] }], ["scryfall"], {
        scryfall: boom,
        tcgplayer: finishOnly("tcgplayer", null),
        manapool: conditionAware("manapool", null)
      })
    ).rejects.toThrow(/No price source could answer/);
    warn.mockRestore();
  });
});

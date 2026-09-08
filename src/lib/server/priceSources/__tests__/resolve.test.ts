import { describe, it, expect, vi } from "vitest";
import { resolvePricesViaSources } from "..";
import { EMPTY_PRICES, PriceSourceAdapter, SourceCard } from "../types";
import { CardPrices } from "@/types/CardPrice";

const cards: SourceCard[] = [
  { id: "a", set: "x" },
  { id: "b", set: "x" },
  { id: "c", set: "y" }
];

function adapter(
  id: PriceSourceAdapter["id"],
  impl: (cards: SourceCard[]) => Record<string, CardPrices> | Promise<Record<string, CardPrices>>
): PriceSourceAdapter {
  return { id, fetchPrices: vi.fn(async (c: SourceCard[]) => impl(c)) };
}
const priced = (usd: string): CardPrices => ({ ...EMPTY_PRICES, usd });

describe("resolvePricesViaSources", () => {
  it("asks sources in order, each only for the cards still unpriced, and stamps the source", async () => {
    const scryfall = adapter("scryfall", () => ({ a: priced("1.00") }));
    const tcgplayer = adapter("tcgplayer", () => ({ b: priced("2.00"), a: priced("9.99") }));
    const manapool = adapter("manapool", () => ({}));

    const result = await resolvePricesViaSources(cards, ["scryfall", "tcgplayer", "manapool"], {
      scryfall,
      tcgplayer,
      manapool
    });

    expect(result.prices.a).toEqual({ ...priced("1.00"), source: "scryfall" });
    expect(result.prices.b).toEqual({ ...priced("2.00"), source: "tcgplayer" });
    expect(result.prices.c).toBeUndefined();
    expect((tcgplayer.fetchPrices as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([
      cards[1],
      cards[2]
    ]);
    expect((manapool.fetchPrices as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([cards[2]]);
    expect(result.succeeded).toEqual(["scryfall", "tcgplayer", "manapool"]);
    expect(result.failures).toEqual([]);
  });

  it("stops once every card is priced", async () => {
    const scryfall = adapter("scryfall", () => ({
      a: priced("1"),
      b: priced("1"),
      c: priced("1")
    }));
    const tcgplayer = adapter("tcgplayer", () => ({}));
    await resolvePricesViaSources(cards, ["scryfall", "tcgplayer"], {
      scryfall,
      tcgplayer,
      manapool: adapter("manapool", () => ({}))
    });
    expect(tcgplayer.fetchPrices).not.toHaveBeenCalled();
  });

  it("skips a failing source and falls through to the next", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await resolvePricesViaSources(cards, ["scryfall", "manapool"], {
      scryfall: adapter("scryfall", () => {
        throw new Error("down");
      }),
      tcgplayer: adapter("tcgplayer", () => ({})),
      manapool: adapter("manapool", () => ({ a: priced("3.00") }))
    });
    expect(result.prices.a?.source).toBe("manapool");
    expect(result.failures).toEqual([{ source: "scryfall", error: "down" }]);
    expect(result.succeeded).toEqual(["manapool"]);
    warn.mockRestore();
  });

  it("does not count a EUR/tix-only answer as a price (keeps walking for a USD price)", async () => {
    const result = await resolvePricesViaSources([cards[0]], ["scryfall", "tcgplayer"], {
      scryfall: adapter("scryfall", () => ({
        a: { ...EMPTY_PRICES, eur: "11658.96", tix: "0.5" }
      })),
      tcgplayer: adapter("tcgplayer", () => ({ a: priced("9000.00") })),
      manapool: adapter("manapool", () => ({}))
    });
    expect(result.prices.a).toEqual({ ...priced("9000.00"), source: "tcgplayer" });
  });

  it("ignores an all-null answer (treats the card as still unpriced)", async () => {
    const result = await resolvePricesViaSources([cards[0]], ["scryfall", "manapool"], {
      scryfall: adapter("scryfall", () => ({ a: { ...EMPTY_PRICES } })),
      tcgplayer: adapter("tcgplayer", () => ({})),
      manapool: adapter("manapool", () => ({ a: priced("0.50") }))
    });
    expect(result.prices.a?.source).toBe("manapool");
  });

  it("throws when a source failed and nothing at all was priced", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = () => {
      throw new Error("boom");
    };
    await expect(
      resolvePricesViaSources(cards, ["scryfall", "tcgplayer"], {
        scryfall: adapter("scryfall", boom),
        tcgplayer: adapter("tcgplayer", () => ({})), // answered, but had nothing
        manapool: adapter("manapool", () => ({}))
      })
    ).rejects.toThrow(/No price source could answer/);
    warn.mockRestore();
  });

  it("does not throw when a source failed but another priced something; reports the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await resolvePricesViaSources(cards, ["scryfall", "tcgplayer"], {
      scryfall: adapter("scryfall", () => ({ a: priced("1.00") })),
      tcgplayer: adapter("tcgplayer", () => {
        throw new Error("mirror down");
      }),
      manapool: adapter("manapool", () => ({}))
    });
    expect(result.prices.a?.source).toBe("scryfall");
    expect(result.prices.b).toBeUndefined();
    expect(result.failures).toEqual([{ source: "tcgplayer", error: "mirror down" }]);
    warn.mockRestore();
  });

  it("returns every card unpriced (no throw) when all sources answer with nothing", async () => {
    const result = await resolvePricesViaSources(cards, ["scryfall", "manapool"], {
      scryfall: adapter("scryfall", () => ({})),
      tcgplayer: adapter("tcgplayer", () => ({})),
      manapool: adapter("manapool", () => ({}))
    });
    expect(result.prices).toEqual({});
    expect(result.failures).toEqual([]);
  });

  it("returns nothing (without throwing) for an empty order", async () => {
    const result = await resolvePricesViaSources(cards, [], {
      scryfall: adapter("scryfall", () => ({})),
      tcgplayer: adapter("tcgplayer", () => ({})),
      manapool: adapter("manapool", () => ({}))
    });
    expect(result.prices).toEqual({});
  });
});

import { describe, it, expect } from "vitest";
import {
  copyPriceView,
  copySetFromCopies,
  describeCopyPriceView,
  rowCopyPrice
} from "@/lib/copyPricing";
import { copiesFromPhysical, copiesFromRow } from "@/lib/selectedCopies";
import { CollectionGroupRow } from "@/components/my-cards-page/collection-view/grouping";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";

const now = new Date("2026-09-08T12:00:00Z").toISOString();
const record = (over: Partial<NonNullable<DetailedPhysicalCard["price"]>> = {}) => ({
  usd: "1.50",
  source: "scryfall",
  finish: "nonfoil",
  condition: "NM",
  conditionMatched: true,
  updatedAt: now,
  ...over
});
const quote = {
  prices: { usd: "2.00", usd_foil: "6.00", usd_etched: null, eur: null, eur_foil: null, tix: null },
  updatedAt: now
};

describe("copySetFromCopies", () => {
  it("reads finish/condition/proxy from the copies (defaults when unset) and folds their prices", () => {
    expect(copySetFromCopies([{ price: record() }, { price: record() }])).toEqual({
      finish: "nonfoil",
      condition: "NM",
      isProxy: false,
      copyPrice: { usd: 1.5, source: "scryfall", conditionMatched: true, updatedAt: now }
    });
    expect(copySetFromCopies([{ finish: "foil", condition: "LP", tags: ["Proxy"] }])).toEqual({
      finish: "foil",
      condition: "LP",
      isProxy: true,
      copyPrice: undefined
    });
    expect(rowCopyPrice([{ price: record({ finish: "foil" }) }], "nonfoil", "NM")).toBeUndefined();
  });
});

describe("copyPriceView / describeCopyPriceView", () => {
  it("is a proxy view regardless of prices", () => {
    const set = copySetFromCopies([{ tags: ["proxy"], price: record() }]);
    expect(copyPriceView(set, quote)).toEqual({ kind: "proxy", usd: 0 });
    expect(describeCopyPriceView({ kind: "proxy", usd: 0 }, set, "USD")).toMatch(/^Proxy/);
  });

  it("uses the copies' own price when present, naming source and condition match", () => {
    const set = copySetFromCopies([
      {
        finish: "foil",
        condition: "LP",
        price: record({ finish: "foil", condition: "LP", usd: "3.50", source: "manapool" })
      }
    ]);
    const view = copyPriceView(set, quote);
    expect(view).toEqual({
      kind: "copy",
      usd: 3.5,
      source: "Mana Pool",
      conditionMatched: true,
      updatedAt: now
    });
    expect(describeCopyPriceView(view, set, "NZD")).toBe(
      "Mana Pool price for foil, LP (Lightly Played), in NZD"
    );
    const unmatched = copyPriceView(
      copySetFromCopies([
        { condition: "MP", price: record({ condition: "MP", conditionMatched: false }) }
      ]),
      quote
    );
    expect(unmatched.kind).toBe("copy");
    expect(
      describeCopyPriceView(
        unmatched,
        { finish: "nonfoil", condition: "MP", isProxy: false },
        "USD"
      )
    ).toMatch(/no MP price available/);
  });

  it("estimates from the printing's finish price otherwise", () => {
    const set = copySetFromCopies([{ finish: "foil", condition: "HP" }]);
    const view = copyPriceView(set, quote);
    expect(view).toEqual({ kind: "estimate", usd: 6, source: "Scryfall", updatedAt: now });
    expect(describeCopyPriceView(view, set, "USD")).toBe(
      "Scryfall foil price in USD, not yet priced for HP (Heavily Played)"
    );
    expect(copyPriceView(set, null)).toMatchObject({
      kind: "estimate",
      usd: null,
      updatedAt: null
    });
  });
});

describe("selected-copies helpers", () => {
  it("copiesFromRow carries the row's ids, attributes, price and location", () => {
    const row = {
      key: "k",
      card: { id: "card-1" },
      finish: "foil",
      condition: "LP",
      isProxy: false,
      copyPrice: { usd: 3.5, conditionMatched: true, updatedAt: now },
      deckId: null,
      physicalCardIds: ["p1", "p2"],
      quantity: 2
    } as unknown as CollectionGroupRow;
    expect(copiesFromRow(row, "Main")).toEqual({
      cardId: "card-1",
      physicalCardIds: ["p1", "p2"],
      finish: "foil",
      condition: "LP",
      isProxy: false,
      copyPrice: row.copyPrice,
      locationName: "Main"
    });
  });

  it("copiesFromPhysical derives a single copy's set", () => {
    const copy = {
      _id: "p9",
      card: { id: "card-1" },
      collectionId: "c1",
      tags: ["Proxy"],
      condition: "MP"
    } as unknown as DetailedPhysicalCard;
    expect(copiesFromPhysical(copy, "Deck A")).toEqual({
      cardId: "card-1",
      physicalCardIds: ["p9"],
      finish: "nonfoil",
      condition: "MP",
      isProxy: true,
      copyPrice: undefined,
      locationName: "Deck A"
    });
  });
});

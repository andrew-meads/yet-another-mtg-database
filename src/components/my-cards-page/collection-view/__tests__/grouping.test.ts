import { describe, it, expect } from "vitest";
import {
  excludeDeckRows,
  groupCollectionCards,
  rowCopyPrice,
  sortGroupRows,
  CollectionGroupRow
} from "@/components/my-cards-page/collection-view/grouping";
import { SlimMtgCard } from "@/types/MtgCard";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";

function makeCard(overrides: Partial<SlimMtgCard> = {}): SlimMtgCard {
  return {
    id: "card-1",
    name: "Lightning Bolt",
    set: "lea",
    set_name: "Limited Edition Alpha",
    released_at: "1993-08-05",
    collector_number: "1",
    ...overrides
  } as SlimMtgCard;
}

function makePhysical(
  _id: string,
  card: SlimMtgCard,
  overrides: Partial<DetailedPhysicalCard> = {}
): DetailedPhysicalCard {
  return { _id, card, collectionId: "coll-1", ...overrides } as DetailedPhysicalCard;
}

function makeRow(overrides: Partial<CollectionGroupRow>): CollectionGroupRow {
  return {
    key: overrides.key ?? "k",
    card: makeCard(),
    finish: "nonfoil",
    condition: "NM",
    isProxy: false,
    deckId: null,
    physicalCardIds: [],
    quantity: 1,
    ...overrides
  };
}

describe("groupCollectionCards", () => {
  it("groups copies by card + notes + tags + deck with a quantity", () => {
    const bolt = makeCard();
    const rows = groupCollectionCards([
      makePhysical("p1", bolt),
      makePhysical("p2", bolt),
      makePhysical("p3", bolt, { notes: "foil" })
    ]);
    expect(rows).toHaveLength(2);
    const plain = rows.find((r) => !r.notes)!;
    expect(plain.quantity).toBe(2);
    expect(plain.physicalCardIds.sort()).toEqual(["p1", "p2"]);
  });

  it("splits rows by finish and condition, treating unset as non-foil / NM", () => {
    const bolt = makeCard();
    const rows = groupCollectionCards([
      makePhysical("p1", bolt),
      makePhysical("p2", bolt, { finish: "nonfoil", condition: "NM" }),
      makePhysical("p3", bolt, { finish: "foil" }),
      makePhysical("p4", bolt, { condition: "LP" }),
      makePhysical("p5", bolt, { finish: "foil", condition: "NM" })
    ]);
    expect(rows).toHaveLength(3);
    const plain = rows.find((r) => r.finish === "nonfoil" && r.condition === "NM")!;
    expect(plain.physicalCardIds.sort()).toEqual(["p1", "p2"]);
    const foil = rows.find((r) => r.finish === "foil")!;
    expect(foil.condition).toBe("NM");
    expect(foil.physicalCardIds.sort()).toEqual(["p3", "p5"]);
    const played = rows.find((r) => r.condition === "LP")!;
    expect(played.finish).toBe("nonfoil");
    expect(played.physicalCardIds).toEqual(["p4"]);
  });
});

describe("rowCopyPrice", () => {
  const now = new Date("2026-09-08T12:00:00Z").toISOString();
  const earlier = new Date("2026-09-07T12:00:00Z").toISOString();
  const priced = (over: Partial<NonNullable<DetailedPhysicalCard["price"]>> = {}) => ({
    price: {
      usd: "1.50",
      source: "scryfall",
      finish: "nonfoil",
      condition: "NM",
      conditionMatched: true,
      updatedAt: now,
      ...over
    }
  });

  it("folds matching copy records into one price with the oldest stamp", () => {
    expect(rowCopyPrice([priced(), priced({ updatedAt: earlier })], "nonfoil", "NM")).toEqual({
      usd: 1.5,
      source: "scryfall",
      conditionMatched: true,
      updatedAt: earlier
    });
  });

  it("is undefined when any copy was never priced or was priced for a different finish/condition", () => {
    expect(rowCopyPrice([priced(), {}], "nonfoil", "NM")).toBeUndefined();
    expect(rowCopyPrice([priced({ finish: "foil" })], "nonfoil", "NM")).toBeUndefined();
    expect(rowCopyPrice([priced({ condition: "LP" })], "nonfoil", "NM")).toBeUndefined();
    expect(rowCopyPrice([], "nonfoil", "NM")).toBeUndefined();
  });

  it("keeps a fetched-but-unpriced record (null usd) and reports an unmatched condition", () => {
    expect(rowCopyPrice([priced({ usd: null, conditionMatched: false })], "nonfoil", "NM")).toEqual(
      {
        usd: null,
        source: "scryfall",
        conditionMatched: false,
        updatedAt: now
      }
    );
  });

  it("flags rows whose copies carry the Proxy tag", () => {
    const bolt = makeCard();
    const rows = groupCollectionCards([
      makePhysical("p1", bolt, { tags: ["proxy"] }),
      makePhysical("p2", bolt)
    ]);
    expect(rows.find((r) => r.tags?.includes("proxy"))!.isProxy).toBe(true);
    expect(rows.find((r) => !r.tags)!.isProxy).toBe(false);
  });

  it("groupCollectionCards attaches the row's copy price", () => {
    const bolt = makeCard();
    const rows = groupCollectionCards([
      makePhysical("p1", bolt, priced()),
      makePhysical("p2", bolt, priced()),
      makePhysical("p3", bolt, { finish: "foil" })
    ]);
    const plain = rows.find((r) => r.finish === "nonfoil")!;
    expect(plain.copyPrice?.usd).toBe(1.5);
    expect(rows.find((r) => r.finish === "foil")!.copyPrice).toBeUndefined();
  });
});

describe("excludeDeckRows", () => {
  it("keeps only rows with no deck assignment", () => {
    const rows = excludeDeckRows([
      makeRow({ key: "loose", deckId: null }),
      makeRow({ key: "in-deck", deckId: "d1", deckName: "Burn" }),
      makeRow({ key: "loose-2", deckId: null })
    ]);
    expect(rows.map((r) => r.key)).toEqual(["loose", "loose-2"]);
  });

  it("returns an empty list when every row is deck-assigned", () => {
    expect(excludeDeckRows([makeRow({ key: "a", deckId: "d1" })])).toEqual([]);
  });
});

describe("sortGroupRows", () => {
  it("sorts by name first", () => {
    const rows = sortGroupRows([
      makeRow({ key: "b", card: makeCard({ name: "Shock" }) }),
      makeRow({ key: "a", card: makeCard({ name: "Lightning Bolt" }) })
    ]);
    expect(rows.map((r) => r.card.name)).toEqual(["Lightning Bolt", "Shock"]);
  });

  it("orders duplicate names by set release date, oldest first", () => {
    const rows = sortGroupRows([
      makeRow({
        key: "new",
        card: makeCard({ id: "c-new", set: "aaa", released_at: "2020-01-01" })
      }),
      makeRow({
        key: "old",
        card: makeCard({ id: "c-old", set: "zzz", released_at: "1993-08-05" })
      })
    ]);
    expect(rows.map((r) => r.key)).toEqual(["old", "new"]);
  });

  it("sorts rows missing a release date before dated ones", () => {
    const rows = sortGroupRows([
      makeRow({ key: "dated", card: makeCard({ released_at: "1993-08-05" }) }),
      makeRow({ key: "undated", card: makeCard({ released_at: undefined }) })
    ]);
    expect(rows.map((r) => r.key)).toEqual(["undated", "dated"]);
  });

  it("orders non-foil before foil and better condition first within a printing", () => {
    const card = makeCard();
    const rows = sortGroupRows([
      makeRow({ key: "foil-lp", card, finish: "foil", condition: "LP" }),
      makeRow({ key: "plain-hp", card, condition: "HP" }),
      makeRow({ key: "etched", card, finish: "etched" }),
      makeRow({ key: "plain", card }),
      makeRow({ key: "foil", card, finish: "foil" })
    ]);
    expect(rows.map((r) => r.key)).toEqual(["plain", "plain-hp", "foil", "foil-lp", "etched"]);
  });

  it("keeps loose-before-deck and deck-name tiebreaks after equal dates", () => {
    const card = makeCard();
    const rows = sortGroupRows([
      makeRow({ key: "deck-b", card, deckId: "d2", deckName: "Burn" }),
      makeRow({ key: "loose", card, deckId: null }),
      makeRow({ key: "deck-a", card, deckId: "d1", deckName: "Aggro" })
    ]);
    expect(rows.map((r) => r.key)).toEqual(["loose", "deck-a", "deck-b"]);
  });
});

import { describe, it, expect } from "vitest";
import {
  groupCollectionCards,
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

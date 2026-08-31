import { describe, it, expect } from "vitest";
import { joinCardEntries } from "@/lib/cardEntries";
import { CardDataMap, DetailedPhysicalCardEntry } from "@/types/PhysicalCard";
import { SlimMtgCard } from "@/types/MtgCard";

function makeSlimCard(id: string, name: string): SlimMtgCard {
  return {
    id,
    name,
    layout: "normal",
    cmc: 1,
    type_line: "Instant",
    set: "tst",
    set_name: "Test Set",
    collector_number: "1",
    rarity: "common"
  };
}

function makeEntry(id: string, cardId: string): DetailedPhysicalCardEntry {
  return { _id: id, cardId, collectionId: "coll-1", deckId: null, isEphemeral: false };
}

describe("joinCardEntries", () => {
  it("joins entries with their card data, preserving order and entry fields", () => {
    const cardData: CardDataMap = { "card-a": makeSlimCard("card-a", "Shock") };
    const entries = [
      { ...makeEntry("pc-1", "card-a"), notes: "foil", tags: ["burn"], deckName: "Burn" }
    ];

    const joined = joinCardEntries(entries, cardData);

    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      _id: "pc-1",
      collectionId: "coll-1",
      notes: "foil",
      tags: ["burn"],
      deckName: "Burn"
    });
    expect(joined[0].card.name).toBe("Shock");
    // The wire-only cardId key is not carried into the joined shape.
    expect(joined[0]).not.toHaveProperty("cardId");
  });

  it("shares one card object reference across copies of the same card", () => {
    const cardData: CardDataMap = { "card-a": makeSlimCard("card-a", "Shock") };
    const joined = joinCardEntries(
      [makeEntry("pc-1", "card-a"), makeEntry("pc-2", "card-a")],
      cardData
    );

    expect(joined).toHaveLength(2);
    expect(joined[0].card).toBe(joined[1].card);
  });

  it("drops entries whose card is missing from the map", () => {
    const cardData: CardDataMap = { "card-a": makeSlimCard("card-a", "Shock") };
    const joined = joinCardEntries(
      [makeEntry("pc-1", "card-a"), makeEntry("pc-2", "card-missing")],
      cardData
    );

    expect(joined.map((c) => c._id)).toEqual(["pc-1"]);
  });

  it("returns [] for empty input", () => {
    expect(joinCardEntries([], {})).toEqual([]);
  });
});

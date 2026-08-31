import { describe, it, expect } from "vitest";
import { assignSwaps, buildFillGroups, FillGroup } from "@/lib/fillDeck";
import { MtgCard } from "@/types/MtgCard";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { DeckWithCards } from "@/types/Deck";

function makeCard(overrides: Partial<MtgCard> = {}): MtgCard {
  return {
    id: "printing-1",
    name: "Lightning Bolt",
    oracle_id: "oracle-bolt",
    set: "lea",
    set_name: "Limited Edition Alpha",
    collector_number: "1",
    ...overrides
  } as MtgCard;
}

function makePhysical(
  _id: string,
  card: MtgCard,
  overrides: Partial<DetailedPhysicalCard> = {}
): DetailedPhysicalCard {
  return { _id, card, collectionId: "coll-1", ...overrides };
}

function makeEphemeral(_id: string, card: MtgCard): DetailedPhysicalCard {
  return { _id, card, collectionId: null, isEphemeral: true };
}

/** A deck with one section and the given columns of cards. */
function makeDeck(...columns: DetailedPhysicalCard[][]): DeckWithCards {
  return {
    _id: "deck-1",
    name: "Test Deck",
    kind: "deck",
    owner: "user-1",
    description: "",
    sections: [
      {
        _id: "sec-1",
        name: "Main",
        columns: columns.map((cards, i) => ({ _id: `col-${i}`, cards }))
      }
    ]
  };
}

const bolt = makeCard();
const boltReprint = makeCard({ id: "printing-2", set: "m10", collector_number: "146" });
const shock = makeCard({ id: "printing-3", name: "Shock", oracle_id: "oracle-shock" });

describe("buildFillGroups", () => {
  it("groups a deck's ephemerals by oracle_id across printings, in deck order", () => {
    const deck = makeDeck(
      [makeEphemeral("e1", bolt), makeEphemeral("e2", shock)],
      [makeEphemeral("e3", boltReprint)]
    );
    const groups = buildFillGroups(deck, []);
    expect(groups.map((g) => g.card.name)).toEqual(["Lightning Bolt", "Shock"]);
    expect(groups[0].ephemerals).toEqual([
      { id: "e1", scryfallId: "printing-1" },
      { id: "e3", scryfallId: "printing-2" }
    ]);
    expect(groups[1].ephemerals).toEqual([{ id: "e2", scryfallId: "printing-3" }]);
  });

  it("falls back to the lowercased name when oracle_id is absent", () => {
    const noOracle = makeCard({ id: "p-a", oracle_id: undefined });
    const noOracleReprint = makeCard({ id: "p-b", oracle_id: undefined, set: "m10" });
    const deck = makeDeck([makeEphemeral("e1", noOracle)]);
    const groups = buildFillGroups(deck, [makePhysical("r1", noOracleReprint)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("lightning bolt");
    expect(groups[0].candidates).toHaveLength(1);
  });

  it("flags and sorts same-printing candidates first", () => {
    const deck = makeDeck([makeEphemeral("e1", bolt)]);
    const groups = buildFillGroups(deck, [
      makePhysical("r-other", boltReprint),
      makePhysical("r-same", bolt)
    ]);
    expect(groups[0].candidates.map((c) => c.physicalCard._id)).toEqual(["r-same", "r-other"]);
    expect(groups[0].candidates.map((c) => c.samePrinting)).toEqual([true, false]);
  });

  it("excludes non-matching, ephemeral, in-this-deck, and deck-assigned collection cards", () => {
    const deck = makeDeck([makeEphemeral("e1", bolt)]);
    const groups = buildFillGroups(deck, [
      makePhysical("r-ok", bolt),
      makePhysical("r-wrong-card", shock),
      { ...makeEphemeral("r-ephemeral", bolt) },
      makePhysical("r-in-this-deck", bolt, { deckId: "deck-1" }),
      makePhysical("r-in-other-deck", bolt, { deckId: "deck-2" })
    ]);
    expect(groups[0].candidates.map((c) => c.physicalCard._id)).toEqual(["r-ok"]);
  });

  it("includes deck-assigned copies (but never this deck's own) with includeDeckAssigned", () => {
    const deck = makeDeck([makeEphemeral("e1", bolt)]);
    const groups = buildFillGroups(
      deck,
      [
        makePhysical("r-loose", bolt),
        makePhysical("r-in-this-deck", bolt, { deckId: "deck-1" }),
        makePhysical("r-in-other-deck", bolt, { deckId: "deck-2" })
      ],
      { includeDeckAssigned: true }
    );
    expect(groups[0].candidates.map((c) => c.physicalCard._id).sort()).toEqual([
      "r-in-other-deck",
      "r-loose"
    ]);
  });

  it("returns no groups for a deck without ephemerals", () => {
    const deck = makeDeck([makePhysical("p1", bolt, { deckId: "deck-1" })]);
    expect(buildFillGroups(deck, [makePhysical("r1", bolt)])).toEqual([]);
  });
});

describe("assignSwaps", () => {
  function group(): FillGroup {
    const deck = makeDeck([
      makeEphemeral("e-alpha", bolt),
      makeEphemeral("e-reprint", boltReprint)
    ]);
    return buildFillGroups(deck, [
      makePhysical("r-alpha", bolt),
      makePhysical("r-reprint", boltReprint),
      makePhysical("r-third", makeCard({ id: "printing-9", set: "sta" }))
    ])[0];
  }

  it("pairs same-printing selections with their identical-printing slots", () => {
    const swaps = assignSwaps(group(), ["r-reprint", "r-alpha"]);
    expect(swaps).toContainEqual({ ephemeralId: "e-alpha", physicalCardId: "r-alpha" });
    expect(swaps).toContainEqual({ ephemeralId: "e-reprint", physicalCardId: "r-reprint" });
  });

  it("assigns different-printing selections to the remaining slots in deck order", () => {
    const swaps = assignSwaps(group(), ["r-third", "r-reprint"]);
    // r-reprint claims its exact-printing slot; r-third takes the first slot left.
    expect(swaps).toContainEqual({ ephemeralId: "e-reprint", physicalCardId: "r-reprint" });
    expect(swaps).toContainEqual({ ephemeralId: "e-alpha", physicalCardId: "r-third" });
  });

  it("ignores selections beyond the number of slots", () => {
    const swaps = assignSwaps(group(), ["r-alpha", "r-reprint", "r-third"]);
    expect(swaps).toHaveLength(2);
    expect(swaps.map((s) => s.physicalCardId).sort()).toEqual(["r-alpha", "r-reprint"]);
  });

  it("ignores ids that are not candidates and handles an empty selection", () => {
    expect(assignSwaps(group(), [])).toEqual([]);
    expect(assignSwaps(group(), ["nope"])).toEqual([]);
  });
});

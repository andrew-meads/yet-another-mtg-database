import { describe, it, expect } from "vitest";
import { countDeckCards, countSectionCards, formatCardCount } from "@/lib/deckUtils";
import type { DeckSection, DeckWithCards } from "@/types/Deck";

function makeSection(id: string, columnSizes: number[]): DeckSection {
  return {
    _id: id,
    name: id,
    columns: columnSizes.map((size, i) => ({
      _id: `${id}-col-${i}`,
      cards: Array.from({ length: size }, (_, j) => ({
        _id: `${id}-${i}-${j}`,
        card: { id: `card-${id}-${i}-${j}`, name: "x" } as never,
        collectionId: "coll-1"
      }))
    }))
  };
}

function makeDeck(sections: DeckSection[]): DeckWithCards {
  return {
    _id: "deck-1",
    name: "Deck",
    kind: "deck",
    owner: "user-1",
    description: "",
    sections
  };
}

describe("countSectionCards", () => {
  it("sums the cards across all columns", () => {
    expect(countSectionCards(makeSection("s1", [3, 4, 1]))).toBe(8);
  });

  it("counts empty columns as zero", () => {
    expect(countSectionCards(makeSection("s1", [0, 2, 0]))).toBe(2);
  });

  it("returns 0 for a section with no columns", () => {
    expect(countSectionCards(makeSection("s1", []))).toBe(0);
  });
});

describe("countDeckCards", () => {
  it("sums the cards across all sections", () => {
    const deck = makeDeck([
      makeSection("s1", [3, 4]),
      makeSection("s2", [1]),
      makeSection("s3", [])
    ]);
    expect(countDeckCards(deck)).toBe(8);
  });

  it("returns 0 for a deck with no sections", () => {
    expect(countDeckCards(makeDeck([]))).toBe(0);
  });
});

describe("formatCardCount", () => {
  it("uses the singular for exactly one card", () => {
    expect(formatCardCount(1)).toBe("1 card");
  });

  it("uses the plural for zero and many", () => {
    expect(formatCardCount(0)).toBe("0 cards");
    expect(formatCardCount(60)).toBe("60 cards");
  });
});

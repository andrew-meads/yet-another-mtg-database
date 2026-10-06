import { describe, it, expect } from "vitest";
import {
  countDeckCards,
  countDeckCardsByKind,
  countSectionCards,
  effectiveSectionKind,
  formatCardCount,
  formatDeckCardCount,
  isDeckSectionKind,
  sortSectionsByKind
} from "@/lib/deckUtils";
import type { DeckSection, DeckSectionKind, DeckWithCards } from "@/types/Deck";

function makeSection(id: string, columnSizes: number[], kind?: DeckSectionKind): DeckSection {
  return {
    _id: id,
    name: id,
    ...(kind ? { kind } : {}),
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

  it("counts only normal sections toward the main deck", () => {
    const deck = makeDeck([
      makeSection("main", [3, 4]),
      makeSection("side", [5], "sideboard"),
      makeSection("maybe", [2], "scratch"),
      makeSection("explicit", [1], "normal")
    ]);
    expect(countDeckCards(deck)).toBe(8);
  });
});

describe("countDeckCardsByKind", () => {
  it("splits the totals into main deck, sideboard, and scratch", () => {
    const deck = makeDeck([
      makeSection("main", [3, 4]),
      makeSection("side", [5], "sideboard"),
      makeSection("side2", [1], "sideboard"),
      makeSection("maybe", [2], "scratch")
    ]);
    expect(countDeckCardsByKind(deck)).toEqual({ normal: 7, sideboard: 6, scratch: 2 });
  });
});

describe("section kinds", () => {
  it("recognizes the three kinds", () => {
    expect(isDeckSectionKind("normal")).toBe(true);
    expect(isDeckSectionKind("sideboard")).toBe(true);
    expect(isDeckSectionKind("scratch")).toBe(true);
    expect(isDeckSectionKind("maybeboard")).toBe(false);
    expect(isDeckSectionKind(undefined)).toBe(false);
    expect(isDeckSectionKind(3)).toBe(false);
  });

  it("reads an absent or unknown kind as normal", () => {
    expect(effectiveSectionKind(undefined)).toBe("normal");
    expect(effectiveSectionKind(null)).toBe("normal");
    expect(effectiveSectionKind("bogus")).toBe("normal");
    expect(effectiveSectionKind("scratch")).toBe("scratch");
  });

  it("orders normal, then sideboard, then scratch, stable within a kind", () => {
    const sorted = sortSectionsByKind([
      { name: "maybe", kind: "scratch" },
      { name: "side", kind: "sideboard" },
      { name: "creatures" },
      { name: "ideas", kind: "scratch" },
      { name: "lands", kind: "normal" }
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["creatures", "lands", "side", "maybe", "ideas"]);
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

describe("formatDeckCardCount", () => {
  it("shows only the main count without a sideboard", () => {
    expect(formatDeckCardCount(60, 0)).toBe("60 cards");
    expect(formatDeckCardCount(1, 0)).toBe("1 card");
  });

  it("appends the sideboard count when there is one", () => {
    expect(formatDeckCardCount(60, 15)).toBe("60 cards + 15 sideboard");
  });
});

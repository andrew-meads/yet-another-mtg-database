import { describe, it, expect } from "vitest";
import {
  groupCounts,
  serializeCardList,
  serializeDeck,
  SerializableCard
} from "@/lib/ai/prompts/deckSerialize";

const cardData: Record<string, SerializableCard> = {
  forest: { name: "Forest", set: "neo", type_line: "Basic Land — Forest" },
  elf: {
    name: "Llanowar Elves",
    set: "dom",
    mana_cost: "{G}",
    type_line: "Creature — Elf Druid"
  }
};

describe("groupCounts", () => {
  it("counts copies preserving first-seen order", () => {
    const counts = groupCounts(["a", "b", "a", "a", "c"]);
    expect([...counts.entries()]).toEqual([
      ["a", 3],
      ["b", 1],
      ["c", 1]
    ]);
  });
});

describe("serializeDeck", () => {
  it("renders sections with counts, costs, and type lines", () => {
    const text = serializeDeck(
      "Test Deck",
      [
        { name: "Creatures", cardIds: ["elf", "elf"] },
        { name: "Lands", cardIds: ["forest", "forest", "forest", "forest"] }
      ],
      cardData
    );
    expect(text).toBe(
      [
        "Deck: Test Deck (6 cards)",
        "## Creatures (2 cards)",
        "2x Llanowar Elves [dom] {G} — Creature — Elf Druid",
        "## Lands (4 cards)",
        "4x Forest [neo] — Basic Land — Forest"
      ].join("\n")
    );
  });

  it("marks empty sections and unknown cards", () => {
    const text = serializeDeck(
      "Sparse",
      [
        { name: "Main", cardIds: ["mystery"] },
        { name: "Side", cardIds: [] }
      ],
      cardData
    );
    expect(text).toContain("1x <unknown card mystery>");
    expect(text).toContain("## Side (0 cards)\n(empty)");
  });
});

describe("serializeCardList", () => {
  it("renders counted lines for a flat copy list", () => {
    const text = serializeCardList(["forest", "elf", "forest"], cardData);
    expect(text).toBe(
      [
        "2x Forest [neo] — Basic Land — Forest",
        "1x Llanowar Elves [dom] {G} — Creature — Elf Druid"
      ].join("\n")
    );
  });
});

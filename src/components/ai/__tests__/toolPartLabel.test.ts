import { describe, it, expect } from "vitest";
import { describeToolPart, isToolPartError } from "@/components/ai/toolPartLabel";

describe("isToolPartError", () => {
  it("flags output-error state and in-band { error } results", () => {
    expect(isToolPartError({ type: "tool-readDeck", state: "output-error" })).toBe(true);
    expect(
      isToolPartError({
        type: "tool-readDeck",
        state: "output-available",
        output: { error: "Deck not found" }
      })
    ).toBe(true);
    expect(
      isToolPartError({ type: "tool-readDeck", state: "output-available", output: { name: "X" } })
    ).toBe(false);
  });
});

describe("describeToolPart", () => {
  it("describes searches with query and match count", () => {
    expect(
      describeToolPart({
        type: "tool-searchCards",
        state: "output-available",
        input: { q: "t:goblin" },
        output: { total: 14 }
      })
    ).toBe("searched all cards: t:goblin (14 matches)");
    expect(
      describeToolPart({
        type: "tool-searchMyCards",
        state: "input-available",
        input: { q: "t:elf" }
      })
    ).toBe("searched your cards: t:elf");
  });

  it("describes deck reads and mana-base analysis", () => {
    expect(
      describeToolPart({
        type: "tool-readDeck",
        state: "output-available",
        output: { name: "Gruul", totalCards: 60 }
      })
    ).toBe('read deck "Gruul" (60 cards)');
    expect(describeToolPart({ type: "tool-readDeck", state: "input-available" })).toBe(
      "reading deck…"
    );
    expect(
      describeToolPart({
        type: "tool-manaBaseStats",
        state: "output-available",
        output: { deckName: "Gruul" }
      })
    ).toBe('analyzed mana base of "Gruul"');
  });

  it("describes lookups", () => {
    expect(
      describeToolPart({
        type: "tool-getCardDetails",
        state: "output-available",
        input: { names: ["Lightning Bolt", "Shock"] }
      })
    ).toBe("looked up Lightning Bolt, Shock");
    expect(
      describeToolPart({
        type: "tool-lookupRule",
        state: "output-available",
        input: { kind: "rule", query: "702.19b" }
      })
    ).toBe("looked up rule 702.19b");
    expect(
      describeToolPart({
        type: "tool-getRulings",
        state: "output-available",
        input: { cardName: "Humility" },
        output: { cardName: "Humility" }
      })
    ).toBe("fetched rulings for Humility");
  });

  it("describes failures with the in-band reason", () => {
    expect(
      describeToolPart({
        type: "tool-readDeck",
        state: "output-available",
        output: { error: "Deck not found" }
      })
    ).toBe("readDeck failed: Deck not found");
  });

  it("falls back to the raw tool name for unknown tools", () => {
    expect(describeToolPart({ type: "tool-mystery", state: "output-available" })).toBe(
      "used mystery"
    );
  });
});

import { describe, it, expect } from "vitest";
import {
  slimComboResponse,
  INCLUDED_COMBO_CAP,
  ALMOST_COMBO_CAP
} from "@/lib/server/comboSearch";

function variant(id: string, cards: string[], produces: string[], description?: string) {
  return {
    id,
    uses: cards.map((name) => ({ card: { name, id: 1, oracleId: "x" }, quantity: 1 })),
    produces: produces.map((name) => ({ feature: { name }, quantity: 1 })),
    description,
    // Verbose fields the slimmer must drop:
    prices: { tcgplayer: "100" },
    legalities: { commander: true },
    popularity: 12345
  };
}

describe("slimComboResponse", () => {
  it("slims included combos to id/url/cards/produces/description", () => {
    const result = slimComboResponse(
      {
        results: {
          included: [
            variant("4131-4235", ["Basalt Monolith", "Rings of Brighthearth"], ["Infinite colorless mana"], "Tap it. Untap it. Repeat.")
          ],
          almostIncluded: []
        }
      },
      ["Basalt Monolith", "Rings of Brighthearth"]
    );

    expect(result.included).toEqual([
      {
        id: "4131-4235",
        url: "https://commanderspellbook.com/combo/4131-4235/",
        cards: ["Basalt Monolith", "Rings of Brighthearth"],
        produces: ["Infinite colorless mana"],
        description: "Tap it. Untap it. Repeat."
      }
    ]);
    expect(result.totalIncluded).toBe(1);
  });

  it("truncates long descriptions", () => {
    const result = slimComboResponse(
      { results: { included: [variant("1", ["A"], ["B"], "x".repeat(700))], almostIncluded: [] } },
      ["A"]
    );
    expect(result.included[0].description).toHaveLength(601);
    expect(result.included[0].description!.endsWith("…")).toBe(true);
  });

  it("computes the missing cards for almost-included combos (case-insensitive)", () => {
    const result = slimComboResponse(
      {
        results: {
          included: [],
          almostIncluded: [variant("2", ["Basalt Monolith", "Forsaken Monument"], ["Infinite mana"])]
        }
      },
      ["basalt monolith", "Sol Ring"]
    );
    expect(result.almostIncluded[0].missing).toEqual(["Forsaken Monument"]);
    // Almost-included combos carry no step description.
    expect(result.almostIncluded[0].description).toBeUndefined();
  });

  it("caps both lists but reports true totals", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => variant(String(i), ["A"], ["B"]));
    const result = slimComboResponse(
      { results: { included: many(30), almostIncluded: many(15) } },
      ["A"]
    );
    expect(result.included).toHaveLength(INCLUDED_COMBO_CAP);
    expect(result.almostIncluded).toHaveLength(ALMOST_COMBO_CAP);
    expect(result.totalIncluded).toBe(30);
    expect(result.totalAlmostIncluded).toBe(15);
  });

  it("tolerates malformed or empty bodies", () => {
    for (const body of [null, {}, { results: {} }, { results: { included: "nope" } }]) {
      const result = slimComboResponse(body, []);
      expect(result.included).toEqual([]);
      expect(result.almostIncluded).toEqual([]);
    }
  });
});

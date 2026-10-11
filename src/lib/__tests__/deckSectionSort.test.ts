import { describe, it, expect } from "vitest";
import {
  SortableCard,
  arrangeSectionColumns,
  colorComboIndex,
  colorGroup,
  isLandForSort,
  manaValueBucket
} from "@/lib/deckSectionSort";

function card(
  id: string,
  cmc: number,
  colors: string[] = [],
  typeLine = "Creature — Test",
  name = id
): SortableCard {
  return { id, name, cmc, typeLine, colors };
}

const land = (id: string, name = id) => card(id, 0, [], "Basic Land — Forest", name);

describe("isLandForSort", () => {
  it("detects lands by the front face only", () => {
    expect(isLandForSort("Basic Land — Island")).toBe(true);
    expect(isLandForSort("Artifact Land")).toBe(true);
    expect(isLandForSort("Land // Creature — Elf")).toBe(true);
    expect(isLandForSort("Sorcery // Land")).toBe(false);
    expect(isLandForSort("Creature — Elf Druid")).toBe(false);
    expect(isLandForSort("Enchantment — Landfall Test")).toBe(false);
  });
});

describe("manaValueBucket", () => {
  it("floors fractional mana values and caps at 7+", () => {
    expect(manaValueBucket(0)).toBe(0);
    expect(manaValueBucket(0.5)).toBe(0);
    expect(manaValueBucket(3)).toBe(3);
    expect(manaValueBucket(7)).toBe(7);
    expect(manaValueBucket(15)).toBe(7);
  });
});

describe("colorGroup / colorComboIndex", () => {
  it("groups by single color, multicolor or colorless", () => {
    expect(colorGroup(["U"])).toBe("U");
    expect(colorGroup(["G", "W"])).toBe("multicolor");
    expect(colorGroup([])).toBe("colorless");
  });

  it("orders combinations WUBRG-first with colorless last", () => {
    expect(colorComboIndex(["W"])).toBeLessThan(colorComboIndex(["U"]));
    expect(colorComboIndex(["G"])).toBeLessThan(colorComboIndex(["U", "W"]));
    // Order within the input doesn't matter.
    expect(colorComboIndex(["U", "W"])).toBe(colorComboIndex(["W", "U"]));
    expect(colorComboIndex(["W", "U"])).toBeLessThan(colorComboIndex(["B", "R"]));
    expect(colorComboIndex([])).toBeGreaterThan(colorComboIndex(["W", "U", "B", "R", "G"]));
  });
});

describe("arrangeSectionColumns — mana value", () => {
  it("starts at MV 1 and leaves placeholder columns for gaps", () => {
    const cards = [card("a", 2), card("b", 5), card("c", 1)];
    expect(arrangeSectionColumns(cards, "manaValue")).toEqual([["c"], ["a"], [], [], ["b"]]);
  });

  it("starts at MV 0 when a non-land has MV 0", () => {
    const cards = [card("a", 2), card("b", 0)];
    expect(arrangeSectionColumns(cards, "manaValue")).toEqual([["b"], [], ["a"]]);
  });

  it("does not start at 0 just because of lands, which get their own last column", () => {
    const cards = [land("l1"), card("a", 2), land("l2")];
    expect(arrangeSectionColumns(cards, "manaValue")).toEqual([[], ["a"], ["l1", "l2"]]);
  });

  it("groups MV 7 and above into one column", () => {
    const cards = [card("a", 7), card("b", 12), card("c", 6)];
    expect(arrangeSectionColumns(cards, "manaValue")).toEqual([
      [],
      [],
      [],
      [],
      [],
      ["c"],
      ["a", "b"]
    ]);
  });

  it("keeps the existing relative order without a secondary key", () => {
    const cards = [card("z", 2, ["G"]), card("a", 2, ["W"]), card("m", 2, [])];
    expect(arrangeSectionColumns(cards, "manaValue")).toEqual([[], ["z", "a", "m"]]);
  });

  it("sorts each column by color, then name, with the secondary key", () => {
    const cards = [
      card("p6", 2, [], undefined, "Mind Stone"),
      card("p5", 2, ["U", "W"], undefined, "Azorius Charm"),
      card("p4", 2, ["G"], undefined, "Lotus Cobra"),
      card("p3", 2, ["W"], undefined, "Thraben Inspector"),
      card("p2", 2, ["W"], undefined, "Adeline"),
      card("p1", 2, ["U"], undefined, "Counterspell")
    ];
    expect(arrangeSectionColumns(cards, "manaValueThenColor")).toEqual([
      [],
      ["p2", "p3", "p1", "p4", "p5", "p6"]
    ]);
  });

  it("sorts each column by name alone when alphabetical", () => {
    const cards = [
      card("p1", 2, ["W"], undefined, "Thraben Inspector"),
      card("p2", 2, ["U"], undefined, "Counterspell"),
      card("p3", 5, ["G"], undefined, "Zoologist"),
      card("p4", 5, ["W"], undefined, "Angel")
    ];
    expect(arrangeSectionColumns(cards, "manaValueThenName")).toEqual([
      [],
      ["p2", "p1"],
      [],
      [],
      ["p4", "p3"]
    ]);
  });

  it("sorts the lands column by name with a secondary key", () => {
    const cards = [card("a", 1), land("l1", "Swamp"), land("l2", "Island")];
    expect(arrangeSectionColumns(cards, "manaValueThenColor")).toEqual([["a"], ["l2", "l1"]]);
  });

  it("handles a lands-only section", () => {
    expect(arrangeSectionColumns([land("l1")], "manaValue")).toEqual([["l1"]]);
  });
});

describe("arrangeSectionColumns — color", () => {
  it("creates only the color columns present, in WUBRG / multicolor / colorless order", () => {
    const cards = [
      card("art", 2, []),
      card("gold", 3, ["B", "G"]),
      card("red", 1, ["R"]),
      card("white", 4, ["W"]),
      land("l")
    ];
    expect(arrangeSectionColumns(cards, "color")).toEqual([
      ["white"],
      ["red"],
      ["gold"],
      ["art"],
      ["l"]
    ]);
  });

  it("uses face colors passed in for double-faced cards", () => {
    // A transform card has empty top-level colors; the server unites the face colors.
    const cards = [card("dfc", 3, ["G"], "Creature — Werewolf // Creature — Werewolf")];
    expect(arrangeSectionColumns(cards, "color")).toEqual([["dfc"]]);
  });

  it("keeps the existing relative order without a secondary key", () => {
    const cards = [card("b", 5, ["U"]), card("a", 1, ["U"])];
    expect(arrangeSectionColumns(cards, "color")).toEqual([["b", "a"]]);
  });

  it("sorts each column by mana value, then name, with the secondary key", () => {
    const cards = [
      card("p1", 5, ["U"], undefined, "Opt B"),
      card("p2", 1, ["U"], undefined, "Opt Z"),
      card("p3", 1, ["U"], undefined, "Opt A")
    ];
    expect(arrangeSectionColumns(cards, "colorThenManaValue")).toEqual([["p3", "p2", "p1"]]);
  });

  it("sorts each column by name alone when alphabetical, ignoring combination", () => {
    const cards = [
      card("br", 1, ["B", "R"], undefined, "Terminate"),
      card("wu", 4, ["W", "U"], undefined, "Absorb"),
      card("u2", 5, ["U"], undefined, "Opt Later"),
      card("u1", 1, ["U"], undefined, "Brainstorm")
    ];
    expect(arrangeSectionColumns(cards, "colorThenName")).toEqual([
      ["u1", "u2"],
      ["wu", "br"]
    ]);
  });

  it("keeps multicolor combinations together before sorting by mana value", () => {
    const cards = [
      card("br5", 5, ["B", "R"]),
      card("wu4", 4, ["W", "U"]),
      card("br1", 1, ["R", "B"]),
      card("wu2", 2, ["U", "W"])
    ];
    expect(arrangeSectionColumns(cards, "colorThenManaValue")).toEqual([
      ["wu2", "wu4", "br1", "br5"]
    ]);
  });
});

describe("arrangeSectionColumns — empty", () => {
  it("returns no columns for an empty section", () => {
    expect(arrangeSectionColumns([], "manaValue")).toEqual([]);
    expect(arrangeSectionColumns([], "color")).toEqual([]);
  });
});

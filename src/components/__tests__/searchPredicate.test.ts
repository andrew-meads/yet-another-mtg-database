import { describe, it, expect } from "vitest";
import { searchPredicate, SearchFilters } from "@/components/SearchDialog";
import { MtgCard } from "@/types/MtgCard";

function card(over: Partial<MtgCard> = {}): MtgCard {
  return {
    id: "x",
    name: "Shivan Dragon",
    type_line: "Creature — Dragon",
    power: "5",
    toughness: "5",
    colors: ["R"],
    color_identity: ["R"],
    set: "lea",
    cmc: 6,
    oracle_text: "Flying",
    ...over
  } as MtgCard;
}

function match(filters: SearchFilters | null, c: MtgCard) {
  return searchPredicate(filters)(c);
}

describe("searchPredicate", () => {
  it("matches everything when filters are null", () => {
    expect(match(null, card())).toBe(true);
  });

  it("filters by name (case-insensitive substring)", () => {
    expect(match({ name: "shiv" }, card())).toBe(true);
    expect(match({ name: "goblin" }, card())).toBe(false);
  });

  it("filters by type line", () => {
    expect(match({ typeLine: "dragon" }, card())).toBe(true);
    expect(match({ typeLine: "instant" }, card())).toBe(false);
  });

  it("filters numeric power with an operator", () => {
    expect(match({ power: "5", powerOperator: ">=" }, card({ power: "5" }))).toBe(true);
    expect(match({ power: "6", powerOperator: ">=" }, card({ power: "5" }))).toBe(false);
    expect(match({ power: "4", powerOperator: ">" }, card({ power: "5" }))).toBe(true);
  });

  it("filters by cmc", () => {
    expect(match({ cmc: "6", cmcOperator: "=" }, card({ cmc: 6 }))).toBe(true);
    expect(match({ cmc: "3", cmcOperator: "<=" }, card({ cmc: 6 }))).toBe(false);
  });

  it("supports color contains / exactly / does-not-contain", () => {
    expect(match({ colors: ["R"], colorMode: "contains" }, card({ colors: ["R", "G"] }))).toBe(true);
    expect(match({ colors: ["R"], colorMode: "exactly" }, card({ colors: ["R", "G"] }))).toBe(false);
    expect(
      match({ colors: ["U"], colorMode: "does-not-contain" }, card({ colors: ["R"] }))
    ).toBe(true);
  });

  it("filters by set and oracle text", () => {
    expect(match({ set: "LEA" }, card({ set: "lea" }))).toBe(true);
    expect(match({ oracleText: "flying" }, card())).toBe(true);
    expect(match({ oracleText: "trample" }, card())).toBe(false);
  });

  it("ANDs all provided filters", () => {
    expect(match({ name: "shivan", typeLine: "dragon", colors: ["R"] }, card())).toBe(true);
    expect(match({ name: "shivan", typeLine: "instant" }, card())).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  analyzeManaBase,
  countPips,
  isLand,
  producedColors,
  ManaBaseCard
} from "@/lib/ai/manaBase";

function card(overrides: Partial<ManaBaseCard>): ManaBaseCard {
  return { name: "Test", type_line: "Creature", cmc: 2, ...overrides };
}

describe("isLand", () => {
  it("detects plain, artifact, and multi-faced lands", () => {
    expect(isLand(card({ type_line: "Basic Land — Forest" }))).toBe(true);
    expect(isLand(card({ type_line: "Artifact Land" }))).toBe(true);
    expect(isLand(card({ type_line: "Instant // Land" }))).toBe(true);
    expect(isLand(card({ type_line: "Creature — Goblin" }))).toBe(false);
    expect(isLand(card({ type_line: "Legendary Creature — Landfall Wizard" }))).toBe(false);
  });
});

describe("producedColors", () => {
  it("prefers produced_mana when present", () => {
    expect(producedColors(card({ produced_mana: ["G", "W"] }))).toEqual(["W", "G"]);
  });

  it("falls back to oracle-text Add clauses", () => {
    expect(producedColors(card({ oracle_text: "{T}: Add {G}." }))).toEqual(["G"]);
    expect(
      producedColors(card({ oracle_text: "{T}: Add {C}{C}. Some other line." }))
    ).toEqual(["C"]);
  });

  it("treats 'any color' as all five colors", () => {
    expect(producedColors(card({ oracle_text: "{T}: Add one mana of any color." }))).toEqual([
      "W",
      "U",
      "B",
      "R",
      "G"
    ]);
  });

  it("scans card faces when the root has no text", () => {
    expect(
      producedColors(card({ card_faces: [{ oracle_text: "Draw a card." }, { oracle_text: "{T}: Add {U}." }] }))
    ).toEqual(["U"]);
  });

  it("ignores mana symbols outside Add clauses", () => {
    expect(producedColors(card({ oracle_text: "{G}: Regenerate this creature." }))).toEqual([]);
  });
});

describe("countPips", () => {
  it("counts colored pips and ignores generic costs", () => {
    expect(countPips("{2}{G}{G}")).toMatchObject({ G: 2, W: 0 });
    expect(countPips("{X}{R}")).toMatchObject({ R: 1 });
  });

  it("counts hybrid symbols toward every named color", () => {
    expect(countPips("{W/U}")).toMatchObject({ W: 1, U: 1 });
    expect(countPips("{2/W}")).toMatchObject({ W: 1 });
    expect(countPips("{G/P}")).toMatchObject({ G: 1 });
  });

  it("counts {C} as a colorless-specific pip", () => {
    expect(countPips("{C}{C}{4}")).toMatchObject({ C: 2 });
  });
});

describe("analyzeManaBase", () => {
  // 8-card mini deck: 3 Forests, 1 dual, 2 one-drops, 1 hybrid two-drop, 1 big spell.
  const forest = card({
    name: "Forest",
    type_line: "Basic Land — Forest",
    cmc: 0,
    produced_mana: ["G"]
  });
  const dual = card({
    name: "Temple Garden",
    type_line: "Land — Forest Plains",
    cmc: 0,
    produced_mana: ["G", "W"]
  });
  const elf = card({
    name: "Llanowar Elves",
    type_line: "Creature — Elf Druid",
    cmc: 1,
    mana_cost: "{G}",
    oracle_text: "{T}: Add {G}."
  });
  const hybrid = card({
    name: "Kitchen Finks",
    type_line: "Creature — Ouphe",
    cmc: 3,
    mana_cost: "{1}{G/W}{G/W}"
  });
  const bigSpell = card({
    name: "Hornet Queen",
    type_line: "Creature — Insect",
    cmc: 7,
    mana_cost: "{4}{G}{G}{G}"
  });

  const deck = [forest, forest, forest, dual, elf, elf, hybrid, bigSpell];
  const stats = analyzeManaBase(deck);

  it("counts lands and nonlands exactly", () => {
    expect(stats.totalCards).toBe(8);
    expect(stats.landCount).toBe(4);
    expect(stats.nonlandCount).toBe(4);
  });

  it("counts sources per color, lands-only subset included", () => {
    // G sources: 3 Forest + 1 dual + 2 Elves = 6; W: the dual only.
    expect(stats.sources.G).toBe(6);
    expect(stats.sources.W).toBe(1);
    expect(stats.landSources.G).toBe(4);
    expect(stats.landSources.W).toBe(1);
  });

  it("counts pips across nonland mana costs (hybrids count both halves)", () => {
    // G pips: elf 1 x2 + hybrid 2 + big spell 3 = 7; W pips: hybrid 2.
    expect(stats.pips.G).toBe(7);
    expect(stats.pips.W).toBe(2);
  });

  it("builds the curve with a 7+ bucket and averages mana value", () => {
    expect(stats.curve).toMatchObject({ "1": 2, "3": 1, "7+": 1 });
    // (1 + 1 + 3 + 7) / 4 = 3
    expect(stats.averageManaValue).toBe(3);
  });

  it("sorts sourcesVsPips by pip demand", () => {
    expect(stats.sourcesVsPips[0]).toEqual({ color: "G", sources: 6, pips: 7 });
    expect(stats.sourcesVsPips[1]).toEqual({ color: "W", sources: 1, pips: 2 });
  });

  it("handles MDFC spell//land faces via joined face costs", () => {
    const mdfc = card({
      name: "Turntimber Symbiosis // Turntimber, Serpentine Wood",
      type_line: "Sorcery // Land",
      cmc: 7,
      card_faces: [{ mana_cost: "{4}{G}{G}{G}" }, { mana_cost: "" }]
    });
    const s = analyzeManaBase([mdfc]);
    // Counts as a land (playable as one), so no curve/pip contribution.
    expect(s.landCount).toBe(1);
    expect(s.pips.G).toBe(0);
  });

  it("returns zeroed stats for an empty list", () => {
    const s = analyzeManaBase([]);
    expect(s.totalCards).toBe(0);
    expect(s.averageManaValue).toBe(0);
    expect(s.sourcesVsPips).toEqual([]);
  });
});

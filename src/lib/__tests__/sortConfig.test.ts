import { describe, it, expect } from "vitest";
import { getValidSortFields, getSortConfig } from "@/lib/sortConfig";

describe("getValidSortFields", () => {
  it("lists every supported sort field", () => {
    expect(getValidSortFields()).toEqual([
      "name",
      "cmc",
      "power",
      "toughness",
      "rarity",
      "set",
      "color",
      "identity"
    ]);
  });
});

describe("getSortConfig", () => {
  it("returns a simple config for plain fields", () => {
    expect(getSortConfig("name")).toEqual({ field: "name" });
    expect(getSortConfig("cmc")?.useAggregation).toBeUndefined();
  });

  it("flags aggregation fields", () => {
    expect(getSortConfig("power")?.useAggregation).toBe(true);
    expect(getSortConfig("color")?.field).toBe("colors");
    expect(getSortConfig("identity")?.field).toBe("color_identity");
  });

  it("returns null for unknown fields", () => {
    expect(getSortConfig("nonsense")).toBeNull();
  });
});

describe("buildAggregationSort - power/toughness", () => {
  it("sorts non-numeric power first when ascending, last when descending", () => {
    const cfg = getSortConfig("power")!;
    const asc = cfg.buildAggregationSort!(1);
    expect(asc[0].$addFields.powerNumeric.$cond.else).toBe(-1);
    expect(asc[1].$sort).toEqual({ powerNumeric: 1 });

    const desc = cfg.buildAggregationSort!(-1);
    expect(desc[0].$addFields.powerNumeric.$cond.else).toBe(999999);
    expect(desc[1].$sort).toEqual({ powerNumeric: -1 });
  });

  it("uses the toughness field for toughness sort", () => {
    const desc = getSortConfig("toughness")!.buildAggregationSort!(-1);
    expect(desc[1].$sort).toEqual({ toughnessNumeric: -1 });
  });
});

describe("buildAggregationSort - rarity", () => {
  it("orders rarities common → mythic", () => {
    const stages = getSortConfig("rarity")!.buildAggregationSort!(1);
    expect(stages[0].$addFields.rarityOrder.$indexOfArray[0]).toEqual([
      "common",
      "uncommon",
      "rare",
      "mythic"
    ]);
    expect(stages[1].$sort).toEqual({ rarityOrder: 1 });
  });
});

describe("buildAggregationSort - color / identity", () => {
  it("sorts on a WUBRG-ordered index and ends with a $sort", () => {
    const stages = getSortConfig("color")!.buildAggregationSort!(1);
    const last = stages[stages.length - 1];
    expect(last.$sort).toEqual({ final_colors_order: 1 });
    // unknown combinations are pushed to the end when ascending
    expect(stages[2].$addFields.final_colors_order.$cond.then).toBe(999999);
  });

  it("pushes unknown combinations to the front when descending", () => {
    const stages = getSortConfig("identity")!.buildAggregationSort!(-1);
    const last = stages[stages.length - 1];
    expect(last.$sort).toEqual({ final_color_identity_order: -1 });
    expect(stages[2].$addFields.final_color_identity_order.$cond.then).toBe(-1);
  });
});

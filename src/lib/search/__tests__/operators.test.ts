import { describe, it, expect } from "vitest";
import {
  colorOperator,
  identityOperator,
  typeOperator,
  oracleOperator,
  manavalueOperator,
  rarityOperator,
  setOperator,
  powerOperator,
  excludeOperator
} from "@/lib/search/operators";

describe("colorOperator", () => {
  it("defaults to 'has all of these colors'", () => {
    expect(colorOperator.buildQuery("red", undefined)).toEqual({ colors: { $all: ["R"] } });
  });

  it("'=' requires an exact color set", () => {
    expect(colorOperator.buildQuery("ur", "=")).toEqual({
      $and: [{ colors: { $all: ["U", "R"] } }, { colors: { $size: 2 } }]
    });
  });

  it("expands guild names", () => {
    expect(colorOperator.buildQuery("azorius", undefined)).toEqual({
      colors: { $all: ["W", "U"] }
    });
  });

  it("treats colorless as 'no colors'", () => {
    expect(colorOperator.buildQuery("c", undefined)).toEqual({
      $or: [{ colors: { $exists: false } }, { colors: { $size: 0 } }]
    });
  });
});

describe("identityOperator", () => {
  it("queries color_identity", () => {
    expect(identityOperator.buildQuery("r", undefined)).toEqual({
      color_identity: { $all: ["R"] }
    });
  });
});

describe("typeOperator / oracleOperator", () => {
  it("type builds a case-insensitive regex on type_line", () => {
    expect(typeOperator.buildQuery("creature", undefined)).toEqual({
      type_line: /creature/i
    });
  });

  it("oracle builds a case-insensitive regex on oracle_text", () => {
    expect(oracleOperator.buildQuery("draw a card", undefined)).toEqual({
      oracle_text: /draw a card/i
    });
  });

  it("escapes regex metacharacters in the value", () => {
    expect(typeOperator.buildQuery("a.b", undefined)).toEqual({ type_line: /a\.b/i });
  });
});

describe("manavalueOperator", () => {
  it("equality with no operator", () => {
    expect(manavalueOperator.buildQuery("3", undefined)).toEqual({ cmc: { $eq: 3 } });
  });

  it("comparison operator", () => {
    expect(manavalueOperator.buildQuery("3", ">=")).toEqual({ cmc: { $gte: 3 } });
  });

  it("even/odd", () => {
    expect(manavalueOperator.buildQuery("even", undefined)).toEqual({ cmc: { $mod: [2, 0] } });
  });
});

describe("rarityOperator", () => {
  it("exact match by default", () => {
    expect(rarityOperator.buildQuery("mythic", undefined)).toEqual({ rarity: "mythic" });
  });

  it("'>=' expands to that rarity and rarer", () => {
    expect(rarityOperator.buildQuery("rare", ">=")).toEqual({
      rarity: { $in: ["rare", "mythic"] }
    });
  });

  it("'<=' expands to that rarity and more common", () => {
    expect(rarityOperator.buildQuery("uncommon", "<=")).toEqual({
      rarity: { $in: ["common", "uncommon"] }
    });
  });

  it("falls back to exact match for unknown rarity", () => {
    expect(rarityOperator.buildQuery("special", ">=")).toEqual({ rarity: "special" });
  });
});

describe("setOperator", () => {
  it("lowercases the set code", () => {
    expect(setOperator.buildQuery("M21", undefined)).toEqual({ set: "m21" });
  });
});

describe("powerOperator", () => {
  it("builds a numeric $expr for numeric values", () => {
    const q = powerOperator.buildQuery("5", ">=");
    expect(q.$expr.$gte[1]).toBe(5);
  });

  it("does string equality for non-numeric '=' (e.g. '*')", () => {
    expect(powerOperator.buildQuery("*", "=")).toEqual({ power: "*" });
  });

  it("returns null for non-numeric with an ordering operator", () => {
    expect(powerOperator.buildQuery("*", ">")).toBeNull();
  });
});

describe("excludeOperator", () => {
  it("excludes extra layouts for exclude:extras", () => {
    const q = excludeOperator.buildQuery("extras", undefined);
    expect(q.type_line).toEqual({ $ne: "Card" });
    expect(q.layout.$nin).toContain("token");
  });

  it("returns null for any other value", () => {
    expect(excludeOperator.buildQuery("other", undefined)).toBeNull();
  });
});

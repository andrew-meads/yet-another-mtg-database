import { describe, it, expect } from "vitest";
import {
  colorOperator,
  identityOperator,
  typeOperator,
  nameOperator,
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
  it("matches the lowercased set code or a partial set name", () => {
    expect(setOperator.buildQuery("M21", undefined)).toEqual({
      $or: [{ set: "m21" }, { set_name: /M21/i }]
    });
  });

  it("matches full/partial set names case-insensitively", () => {
    const q = setOperator.buildQuery("Throne of Eldraine", undefined);
    expect(q.$or[1].set_name.test("Throne of Eldraine")).toBe(true);
    expect(q.$or[1].set_name.test("throne of eldraine")).toBe(true);
    expect(
      setOperator.buildQuery("eldraine", undefined).$or[1].set_name.test("Throne of Eldraine")
    ).toBe(true);
  });

  it("escapes regex metacharacters in the value", () => {
    const q = setOperator.buildQuery("fire & ice (2nd)", undefined);
    expect(q.$or[1].set_name.test("Fire & Ice (2nd)")).toBe(true);
    expect(q.$or[1].set_name.test("Fire and Ice 2nd")).toBe(false);
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

describe("oracleOperator — regex values", () => {
  it("treats a slash-delimited value as a raw regex", () => {
    const query = oracleOperator.buildQuery("/draw . cards?/");
    expect(query.oracle_text).toBeInstanceOf(RegExp);
    expect(query.oracle_text.source).toBe("draw . cards?");
    expect(query.oracle_text.flags).toBe("i");
  });

  it("still escapes plain values literally", () => {
    const query = oracleOperator.buildQuery("draw . cards?");
    expect(query.oracle_text.source).toBe("draw \\. cards\\?");
  });

  it("falls back to a literal match for an invalid regex", () => {
    const query = oracleOperator.buildQuery("/draw [/");
    // The raw value (slashes included) is matched literally instead of erroring.
    expect(query.oracle_text).toBeInstanceOf(RegExp);
    expect(query.oracle_text.test("text with /draw [/ inside")).toBe(true);
    expect(query.oracle_text.test("draw a card")).toBe(false);
  });
});

describe("nameOperator / typeOperator — regex values", () => {
  it("treats a slash-delimited name value as a raw regex on name and flavor_name", () => {
    const query = nameOperator.buildQuery("/^goblin .* boss$/");
    expect(query.$or[0].name).toBeInstanceOf(RegExp);
    expect(query.$or[0].name.source).toBe("^goblin .* boss$");
    expect(query.$or[0].name.flags).toBe("i");
    expect(query.$or[1].flavor_name.source).toBe("^goblin .* boss$");
  });

  it("treats a slash-delimited type value as a raw regex", () => {
    const query = typeOperator.buildQuery("/^legendary creature/");
    expect(query.type_line).toBeInstanceOf(RegExp);
    expect(query.type_line.source).toBe("^legendary creature");
    expect(query.type_line.test("Legendary Creature — Elf")).toBe(true);
    expect(query.type_line.test("Enchantment — Legendary Creature? no")).toBe(false);
  });

  it("keeps plain name/type values literal", () => {
    expect(nameOperator.buildQuery("a.b").$or[0].name.source).toBe("a\\.b");
    expect(typeOperator.buildQuery("a.b").type_line.source).toBe("a\\.b");
  });
});

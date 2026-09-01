import { describe, it, expect } from "vitest";
import {
  colorOperator,
  identityOperator,
  typeOperator,
  nameOperator,
  oracleOperator,
  producesOperator,
  yearOperator,
  isOperator,
  flavortextOperator,
  manavalueOperator,
  rarityOperator,
  setOperator,
  powerOperator,
  excludeOperator
} from "@/lib/search/operators";

describe("colorOperator", () => {
  // Colors are compared as $expr set operations over the UNION of top-level
  // colors and all face colors (transform/MDFC cards store colors on faces).
  it("defaults to 'has all of these colors' over the face union", () => {
    const q = colorOperator.buildQuery("red", undefined);
    expect(q.$expr.$setIsSubset[0]).toEqual(["R"]);
    // The other side is the effective-colors union expression.
    expect(JSON.stringify(q.$expr.$setIsSubset[1])).toContain("card_faces");
  });

  it("'=' requires an exact color set", () => {
    const q = colorOperator.buildQuery("ur", "=");
    expect(q.$expr.$setEquals[1]).toEqual(["U", "R"]);
  });

  it("'<=' is a subset comparison", () => {
    const q = colorOperator.buildQuery("ur", "<=");
    expect(q.$expr.$setIsSubset[1]).toEqual(["U", "R"]);
    expect(JSON.stringify(q.$expr.$setIsSubset[0])).toContain("card_faces");
  });

  it("expands guild names", () => {
    const q = colorOperator.buildQuery("azorius", undefined);
    expect(q.$expr.$setIsSubset[0]).toEqual(["W", "U"]);
  });

  it("treats colorless as 'no colors on the card or any face'", () => {
    const q = colorOperator.buildQuery("c", undefined);
    expect(q.$expr.$eq[1]).toBe(0);
    expect(JSON.stringify(q.$expr.$eq[0])).toContain("card_faces");
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
  // Text operators match the top-level field OR the same field on any face.
  it("type builds a case-insensitive regex on type_line and face type lines", () => {
    expect(typeOperator.buildQuery("creature", undefined)).toEqual({
      $or: [{ type_line: /creature/i }, { "card_faces.type_line": /creature/i }]
    });
  });

  it("oracle builds a case-insensitive regex on oracle_text and face oracle text", () => {
    expect(oracleOperator.buildQuery("draw a card", undefined)).toEqual({
      $or: [{ oracle_text: /draw a card/i }, { "card_faces.oracle_text": /draw a card/i }]
    });
  });

  it("escapes regex metacharacters in the value", () => {
    expect(typeOperator.buildQuery("a.b", undefined).$or[0]).toEqual({ type_line: /a\.b/i });
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
    expect(query.$or[0].oracle_text).toBeInstanceOf(RegExp);
    expect(query.$or[0].oracle_text.source).toBe("draw . cards?");
    expect(query.$or[0].oracle_text.flags).toBe("i");
    expect(query.$or[1]["card_faces.oracle_text"].source).toBe("draw . cards?");
  });

  it("still escapes plain values literally", () => {
    const query = oracleOperator.buildQuery("draw . cards?");
    expect(query.$or[0].oracle_text.source).toBe("draw \\. cards\\?");
  });

  it("falls back to a literal match for an invalid regex", () => {
    const query = oracleOperator.buildQuery("/draw [/");
    // The raw value (slashes included) is matched literally instead of erroring.
    expect(query.$or[0].oracle_text).toBeInstanceOf(RegExp);
    expect(query.$or[0].oracle_text.test("text with /draw [/ inside")).toBe(true);
    expect(query.$or[0].oracle_text.test("draw a card")).toBe(false);
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
    const regex = query.$or[0].type_line;
    expect(regex).toBeInstanceOf(RegExp);
    expect(regex.source).toBe("^legendary creature");
    expect(regex.test("Legendary Creature — Elf")).toBe(true);
    expect(regex.test("Enchantment — Legendary Creature? no")).toBe(false);
  });

  it("keeps plain name/type values literal", () => {
    expect(nameOperator.buildQuery("a.b").$or[0].name.source).toBe("a\\.b");
    expect(typeOperator.buildQuery("a.b").$or[0].type_line.source).toBe("a\\.b");
  });

  it("name regex also matches face names", () => {
    const query = nameOperator.buildQuery("/^insectile/");
    expect(query.$or[2]["card_faces.name"].source).toBe("^insectile");
  });
});

describe("producesOperator", () => {
  it("matches produced_mana with 'has at least' semantics", () => {
    expect(producesOperator.buildQuery("g", undefined)).toEqual({
      produced_mana: { $all: ["G"] }
    });
    expect(producesOperator.buildQuery("wu", undefined)).toEqual({
      produced_mana: { $all: ["W", "U"] }
    });
  });

  it("maps c / colorless to the literal C symbol", () => {
    expect(producesOperator.buildQuery("c", undefined)).toEqual({
      produced_mana: { $all: ["C"] }
    });
    expect(producesOperator.buildQuery("colorless", undefined)).toEqual({
      produced_mana: { $all: ["C"] }
    });
  });

  it("returns null for unparseable values", () => {
    expect(producesOperator.buildQuery("xyz9", undefined)).toBeNull();
  });
});

describe("yearOperator", () => {
  it("treats a bare year as the whole year", () => {
    expect(yearOperator.buildQuery("2020", undefined)).toEqual({
      released_at: { $gte: "2020", $lt: "2021" }
    });
    expect(yearOperator.buildQuery("2020", ">=")).toEqual({ released_at: { $gte: "2020" } });
    expect(yearOperator.buildQuery("2020", "<=")).toEqual({ released_at: { $lt: "2021" } });
    expect(yearOperator.buildQuery("2020", ">")).toEqual({ released_at: { $gte: "2021" } });
    expect(yearOperator.buildQuery("2020", "<")).toEqual({ released_at: { $lt: "2020" } });
  });

  it("compares full dates directly", () => {
    expect(yearOperator.buildQuery("2019-07-12", "<=")).toEqual({
      released_at: { $lte: "2019-07-12" }
    });
    expect(yearOperator.buildQuery("2019-07-12", undefined)).toEqual({
      released_at: "2019-07-12"
    });
  });

  it("returns null for malformed values", () => {
    expect(yearOperator.buildQuery("recent", undefined)).toBeNull();
    expect(yearOperator.buildQuery("20", ">=")).toBeNull();
  });
});

describe("isOperator", () => {
  it("maps layout predicates", () => {
    expect(isOperator.buildQuery("mdfc", undefined)).toEqual({ layout: "modal_dfc" });
    expect(isOperator.buildQuery("transform", undefined)).toEqual({ layout: "transform" });
    expect(isOperator.buildQuery("DFC", undefined).layout.$in).toContain("modal_dfc");
  });

  it("vanilla requires a normal-layout creature with no rules text", () => {
    const q = isOperator.buildQuery("vanilla", undefined);
    expect(q.layout).toBe("normal");
    expect(q.type_line.test("Creature — Bear")).toBe(true);
  });

  it("returns null for unknown predicates", () => {
    expect(isOperator.buildQuery("banana", undefined)).toBeNull();
  });
});

describe("flavortextOperator", () => {
  it("matches flavor text on the card or its faces, with regex support", () => {
    const literal = flavortextOperator.buildQuery("squirrel", undefined);
    expect(literal.$or[0].flavor_text.source).toBe("squirrel");
    expect(literal.$or[1]["card_faces.flavor_text"].source).toBe("squirrel");

    const regex = flavortextOperator.buildQuery("/jaya .* says/", undefined);
    expect(regex.$or[0].flavor_text.source).toBe("jaya .* says");
  });
});

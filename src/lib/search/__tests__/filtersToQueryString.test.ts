import { describe, it, expect } from "vitest";
import { filtersToQueryString, SearchFilters } from "@/lib/search/filtersToQueryString";
import { parseSearchQuery } from "@/lib/search/queryBuilder";

describe("filtersToQueryString", () => {
  it("returns an empty string for an empty model", () => {
    expect(filtersToQueryString({})).toBe("");
  });

  it("ignores empty/whitespace-only fields", () => {
    expect(filtersToQueryString({ name: "  ", typeLine: "" })).toBe("");
  });

  it("maps simple text fields to their operators", () => {
    const filters: SearchFilters = {
      name: "Bolt",
      flavorName: "Godzilla",
      typeLine: "Creature",
      oracleText: "flying",
      set: "neo",
      lang: "ja",
      layout: "transform",
      keyword: "haste"
    };
    expect(filtersToQueryString(filters)).toBe(
      "name:Bolt fn:Godzilla t:Creature o:flying e:neo lang:ja layout:transform kw:haste"
    );
  });

  it("quotes values containing whitespace", () => {
    expect(filtersToQueryString({ name: "Black Lotus" })).toBe('name:"Black Lotus"');
    expect(filtersToQueryString({ oracleText: "draw a card" })).toBe('o:"draw a card"');
  });

  it("uses the colon form for equality and the operator form otherwise", () => {
    expect(filtersToQueryString({ cmc: "3", cmcOperator: "=" })).toBe("mv:3");
    expect(filtersToQueryString({ cmc: "3", cmcOperator: ">=" })).toBe("mv>=3");
    expect(filtersToQueryString({ power: "5", powerOperator: ">" })).toBe("pow>5");
    expect(filtersToQueryString({ toughness: "2", toughnessOperator: "<=" })).toBe("tou<=2");
    expect(filtersToQueryString({ loyalty: "4", loyaltyOperator: "<" })).toBe("loy<4");
  });

  it("defaults a missing numeric operator to equality (colon form)", () => {
    expect(filtersToQueryString({ cmc: "3" })).toBe("mv:3");
  });

  it("maps rarity with and without a comparison operator", () => {
    expect(filtersToQueryString({ rarity: "mythic" })).toBe("r:mythic");
    expect(filtersToQueryString({ rarity: "rare", rarityOperator: ">=" })).toBe("r>=rare");
  });

  it("maps the three color modes", () => {
    expect(filtersToQueryString({ colors: ["R", "G"], colorMode: "contains" })).toBe("c>=rg");
    expect(filtersToQueryString({ colors: ["R", "G"], colorMode: "exactly" })).toBe("c=rg");
    expect(filtersToQueryString({ colors: ["R", "G"], colorMode: "does-not-contain" })).toBe(
      "-c:r -c:g"
    );
  });

  it("defaults color mode to contains", () => {
    expect(filtersToQueryString({ colors: ["U"] })).toBe("c>=u");
  });

  it("maps color identity the same way under the id operator", () => {
    expect(filtersToQueryString({ colorIdentity: ["W", "U"], colorIdentityMode: "exactly" })).toBe(
      "id=wu"
    );
  });

  it("appends exclude:extras when requested", () => {
    expect(filtersToQueryString({ typeLine: "Creature", excludeExtras: true })).toBe(
      "t:Creature exclude:extras"
    );
  });

  it("combines many fields into a single space-separated string", () => {
    const filters: SearchFilters = {
      typeLine: "Creature",
      colors: ["R"],
      colorMode: "contains",
      cmc: "3",
      cmcOperator: ">=",
      rarity: "mythic"
    };
    expect(filtersToQueryString(filters)).toBe("t:Creature r:mythic mv>=3 c>=r");
  });

  it("produces strings that re-parse through parseSearchQuery without throwing", () => {
    const filters: SearchFilters = {
      name: "Black Lotus",
      typeLine: "Creature",
      oracleText: "draw a card",
      colors: ["R", "G"],
      colorMode: "does-not-contain",
      colorIdentity: ["W", "U"],
      colorIdentityMode: "exactly",
      cmc: "3",
      cmcOperator: ">=",
      power: "2",
      powerOperator: ">",
      rarity: "rare",
      rarityOperator: ">=",
      keyword: "flying",
      excludeExtras: true
    };
    const query = filtersToQueryString(filters);
    expect(() => parseSearchQuery(query)).not.toThrow();
    const parsed = parseSearchQuery(query);
    expect(parsed).toBeTypeOf("object");
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
  });

  it("round-trips a single color contains filter to the expected mongo query", () => {
    const query = filtersToQueryString({ colors: ["R"], colorMode: "contains" });
    expect(query).toBe("c>=r");
    expect(parseSearchQuery(query)).toEqual({ colors: { $all: ["R"] } });
  });
});

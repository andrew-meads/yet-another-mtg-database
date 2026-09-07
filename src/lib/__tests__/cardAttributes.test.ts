import { describe, it, expect } from "vitest";
import {
  CARD_CONDITIONS,
  CARD_FINISHES,
  attributesKey,
  attributesMatch,
  conditionRank,
  describeAttributes,
  effectiveCondition,
  effectiveFinish,
  finishRank,
  isCardCondition,
  isCardFinish,
  sparseAttributes
} from "@/lib/cardAttributes";

describe("cardAttributes guards", () => {
  it("accepts every registered finish and condition", () => {
    for (const f of CARD_FINISHES) expect(isCardFinish(f)).toBe(true);
    for (const c of CARD_CONDITIONS) expect(isCardCondition(c)).toBe(true);
  });

  it("rejects unknown values, wrong case, and non-strings", () => {
    expect(isCardFinish("Foil")).toBe(false);
    expect(isCardFinish("glossy")).toBe(false);
    expect(isCardFinish(undefined)).toBe(false);
    expect(isCardFinish(1)).toBe(false);
    expect(isCardCondition("nm")).toBe(false);
    expect(isCardCondition("EX")).toBe(false);
    expect(isCardCondition(null)).toBe(false);
  });
});

describe("defaults", () => {
  it("treats unset as non-foil / NM", () => {
    expect(effectiveFinish(undefined)).toBe("nonfoil");
    expect(effectiveFinish(null)).toBe("nonfoil");
    expect(effectiveCondition(undefined)).toBe("NM");
    expect(effectiveCondition(null)).toBe("NM");
  });

  it("passes explicit values through", () => {
    expect(effectiveFinish("etched")).toBe("etched");
    expect(effectiveCondition("DMG")).toBe("DMG");
  });

  it("keys and matches unset values identically to explicit defaults", () => {
    expect(attributesKey(undefined, undefined)).toBe(attributesKey("nonfoil", "NM"));
    expect(attributesKey("foil", undefined)).toBe("foil|NM");
    expect(attributesMatch({}, { finish: "nonfoil", condition: "NM" })).toBe(true);
    expect(attributesMatch({ finish: "foil" }, {})).toBe(false);
    expect(attributesMatch({ condition: "LP" }, { condition: "LP", finish: "nonfoil" })).toBe(true);
  });
});

describe("ordering", () => {
  it("ranks the default finish first and conditions best to worst", () => {
    expect(finishRank(undefined)).toBe(0);
    expect(finishRank("foil")).toBeGreaterThan(finishRank("nonfoil"));
    expect(finishRank("etched")).toBeGreaterThan(finishRank("foil"));
    expect(conditionRank(undefined)).toBe(0);
    expect(conditionRank("LP")).toBeLessThan(conditionRank("DMG"));
  });
});

describe("sparseAttributes", () => {
  it("drops defaults and unset values, keeps everything else", () => {
    expect(sparseAttributes(undefined, undefined)).toEqual({});
    expect(sparseAttributes("nonfoil", "NM")).toEqual({});
    expect(sparseAttributes("foil", "NM")).toEqual({ finish: "foil" });
    expect(sparseAttributes(null, "MP")).toEqual({ condition: "MP" });
  });
});

describe("describeAttributes", () => {
  it("is null for an ordinary copy", () => {
    expect(describeAttributes(undefined, undefined)).toBeNull();
    expect(describeAttributes("nonfoil", "NM")).toBeNull();
  });

  it("names only the non-default parts", () => {
    expect(describeAttributes("foil", undefined)).toBe("Foil");
    expect(describeAttributes(undefined, "HP")).toBe("HP");
    expect(describeAttributes("etched", "LP")).toBe("Etched foil · LP");
  });
});

import { describe, it, expect } from "vitest";
import {
  parseColors,
  parseComparison,
  parseEvenOdd,
  escapeRegex,
  parseRegexValue,
  buildNumericStringComparison
} from "@/lib/search/helpers";

describe("parseColors", () => {
  it("maps single full names and letters", () => {
    expect(parseColors("red")).toEqual(["R"]);
    expect(parseColors("ur")).toEqual(["U", "R"]);
  });

  it("maps guild / shard / wedge names", () => {
    expect(parseColors("azorius")).toEqual(["W", "U"]);
    expect(parseColors("jund")).toEqual(["B", "R", "G"]);
    expect(parseColors("jeskai")).toEqual(["U", "R", "W"]);
  });

  it("parses multi-letter strings", () => {
    expect(parseColors("wubr")).toEqual(["W", "U", "B", "R"]);
  });

  it("treats colorless aliases as an empty array", () => {
    expect(parseColors("c")).toEqual([]);
    expect(parseColors("colorless")).toEqual([]);
  });

  it("dedupes repeated colors", () => {
    expect(parseColors("rr")).toEqual(["R"]);
  });

  it("is case-insensitive", () => {
    expect(parseColors("UR")).toEqual(["U", "R"]);
  });
});

describe("parseComparison", () => {
  it("maps each operator", () => {
    expect(parseComparison(">=3")).toEqual({ operator: "$gte", value: 3 });
    expect(parseComparison("<=4")).toEqual({ operator: "$lte", value: 4 });
    expect(parseComparison(">5")).toEqual({ operator: "$gt", value: 5 });
    expect(parseComparison("<5")).toEqual({ operator: "$lt", value: 5 });
    expect(parseComparison("=2")).toEqual({ operator: "$eq", value: 2 });
    expect(parseComparison("!=2")).toEqual({ operator: "$ne", value: 2 });
  });

  it("defaults to equality when no operator is present", () => {
    expect(parseComparison("3")).toEqual({ operator: "$eq", value: 3 });
  });
});

describe("parseEvenOdd", () => {
  it("maps even/odd to a modulo query (case-insensitive)", () => {
    expect(parseEvenOdd("even")).toEqual({ $mod: [2, 0] });
    expect(parseEvenOdd("ODD")).toEqual({ $mod: [2, 1] });
  });

  it("returns null for anything else", () => {
    expect(parseEvenOdd("3")).toBeNull();
  });
});

describe("escapeRegex", () => {
  it("escapes regex metacharacters", () => {
    expect(escapeRegex("a.b*c+")).toBe("a\\.b\\*c\\+");
    expect(escapeRegex("(x)[y]")).toBe("\\(x\\)\\[y\\]");
  });

  it("leaves plain text untouched", () => {
    expect(escapeRegex("lightning")).toBe("lightning");
  });
});

describe("buildNumericStringComparison", () => {
  it("builds an $expr with the mapped comparison and value", () => {
    const q = buildNumericStringComparison("power", ">=", 3);
    expect(q.$expr.$gte[1]).toBe(3);
    // first operand coerces the string field to an int (non-numeric -> 0)
    expect(q.$expr.$gte[0].$cond).toBeDefined();
  });

  it("defaults to equality when operator is undefined", () => {
    const q = buildNumericStringComparison("toughness", undefined, 2);
    expect(q.$expr.$eq[1]).toBe(2);
  });

  it("supports not-equal", () => {
    const q = buildNumericStringComparison("loyalty", "!=", 4);
    expect(q.$expr.$ne[1]).toBe(4);
  });
});

describe("parseRegexValue", () => {
  it("builds a case-insensitive regex from a slash-delimited value", () => {
    const regex = parseRegexValue("/draw . cards?/");
    expect(regex).toBeInstanceOf(RegExp);
    expect(regex!.source).toBe("draw . cards?");
    expect(regex!.flags).toBe("i");
    expect(regex!.test("Draw a card")).toBe(true);
    expect(regex!.test("draw 3 cards")).toBe(true);
    expect(regex!.test("discard a card")).toBe(false);
  });

  it("honors regex escapes so \\. matches a literal dot", () => {
    const regex = parseRegexValue("/draw \\. cards/");
    expect(regex!.test("draw . cards")).toBe(true);
    expect(regex!.test("draw x cards")).toBe(false);
  });

  it("supports escaped slashes in the body", () => {
    const regex = parseRegexValue("/either\\/or/");
    expect(regex!.test("Either/Or")).toBe(true);
  });

  it("returns null for non-slash-delimited values", () => {
    expect(parseRegexValue("draw a card")).toBeNull();
    expect(parseRegexValue("/unterminated")).toBeNull();
    expect(parseRegexValue("/")).toBeNull();
    expect(parseRegexValue("//")).toBeNull();
  });

  it("returns null when the closing slash is escaped (unterminated)", () => {
    expect(parseRegexValue("/foo\\/")).toBeNull();
  });

  it("returns null for an invalid pattern", () => {
    expect(parseRegexValue("/draw [/")).toBeNull();
  });
});

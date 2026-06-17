import { describe, it, expect } from "vitest";
import { buildSearchQuery, parseSearchQuery } from "@/lib/search/queryBuilder";
import { findOperatorConfig } from "@/lib/search/config";
import { colorOperator } from "@/lib/search/operators";

describe("buildSearchQuery", () => {
  it("returns {} for empty/whitespace input", () => {
    expect(buildSearchQuery("")).toEqual({});
    expect(buildSearchQuery("   ")).toEqual({});
  });

  it("builds a single operator query", () => {
    expect(buildSearchQuery("c:red")).toEqual({ colors: { $all: ["R"] } });
  });

  it("ANDs multiple terms", () => {
    expect(buildSearchQuery("t:creature mv>=3")).toEqual({
      $and: [{ type_line: /creature/i }, { cmc: { $gte: 3 } }]
    });
  });

  it("treats a bare term as a name / flavor_name search", () => {
    expect(buildSearchQuery("dragon")).toEqual({
      $or: [{ name: /dragon/i }, { flavor_name: /dragon/i }]
    });
  });

  it("handles explicit OR", () => {
    expect(buildSearchQuery("t:goblin or t:elf")).toEqual({
      $or: [{ type_line: /goblin/i }, { type_line: /elf/i }]
    });
  });

  it("handles parenthesised OR inside an AND", () => {
    expect(buildSearchQuery("c:red (t:goblin or t:elf)")).toEqual({
      $and: [
        { colors: { $all: ["R"] } },
        { $or: [{ type_line: /goblin/i }, { type_line: /elf/i }] }
      ]
    });
  });

  it("wraps negation in $nor", () => {
    expect(buildSearchQuery("-t:creature")).toEqual({
      $nor: [{ type_line: /creature/i }]
    });
  });

  it("ignores unknown operators", () => {
    expect(buildSearchQuery("xyz:foo")).toEqual({});
  });
});

describe("parseSearchQuery", () => {
  it("returns {} for null/undefined", () => {
    expect(parseSearchQuery(null)).toEqual({});
    expect(parseSearchQuery(undefined)).toEqual({});
  });

  it("delegates to buildSearchQuery for real input", () => {
    expect(parseSearchQuery("c:red")).toEqual({ colors: { $all: ["R"] } });
  });
});

describe("findOperatorConfig", () => {
  it("resolves aliases (case-insensitive)", () => {
    expect(findOperatorConfig("c")).toBe(colorOperator);
    expect(findOperatorConfig("COLOR")).toBe(colorOperator);
  });

  it("returns null for unknown keys", () => {
    expect(findOperatorConfig("zzz")).toBeNull();
  });
});

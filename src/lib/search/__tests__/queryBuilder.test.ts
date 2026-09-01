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
    expect(JSON.stringify(buildSearchQuery("c:red").$expr.$setIsSubset[0])).toBe('["R"]');
  });

  it("ANDs multiple terms", () => {
    expect(buildSearchQuery("t:creature mv>=3")).toEqual({
      $and: [
        { $or: [{ type_line: /creature/i }, { "card_faces.type_line": /creature/i }] },
        { cmc: { $gte: 3 } }
      ]
    });
  });

  it("treats a bare term as a name / flavor_name search", () => {
    expect(buildSearchQuery("dragon")).toEqual({
      $or: [{ name: /dragon/i }, { flavor_name: /dragon/i }]
    });
  });

  it("handles explicit OR", () => {
    expect(buildSearchQuery("t:goblin or t:elf")).toEqual({
      $or: [
        { $or: [{ type_line: /goblin/i }, { "card_faces.type_line": /goblin/i }] },
        { $or: [{ type_line: /elf/i }, { "card_faces.type_line": /elf/i }] }
      ]
    });
  });

  it("handles parenthesised OR inside an AND", () => {
    expect(buildSearchQuery("c:red (t:goblin or t:elf)")).toEqual({
      $and: [
        expect.objectContaining({ $expr: expect.anything() }),
        {
          $or: [
            { $or: [{ type_line: /goblin/i }, { "card_faces.type_line": /goblin/i }] },
            { $or: [{ type_line: /elf/i }, { "card_faces.type_line": /elf/i }] }
          ]
        }
      ]
    });
  });

  it("wraps negation in $nor", () => {
    expect(buildSearchQuery("-t:creature")).toEqual({
      $nor: [{ $or: [{ type_line: /creature/i }, { "card_faces.type_line": /creature/i }] }]
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
    expect(JSON.stringify(parseSearchQuery("c:red").$expr.$setIsSubset[0])).toBe('["R"]');
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

describe("parseSearchQuery — oracle regex", () => {
  it("parses a regex oracle term with spaces end-to-end", () => {
    const query = parseSearchQuery("t:creature -c:green o:/draw . cards?/");
    // The regex term survives tokenization intact and lands as a raw RegExp.
    const flattened = JSON.stringify(query, (_k, v) => (v instanceof RegExp ? v.source : v));
    expect(flattened).toContain("draw . cards?");
  });

  it("regex and literal oracle terms coexist", () => {
    const query = parseSearchQuery('o:/draw .{1,3} cards?/ o:"at the beginning"');
    const sources: string[] = [];
    JSON.stringify(query, (_k, v) => {
      if (v instanceof RegExp) sources.push(v.source);
      return v;
    });
    expect(sources).toContain("draw .{1,3} cards?");
    expect(sources).toContain("at the beginning");
  });
});

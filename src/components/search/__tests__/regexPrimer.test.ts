import { describe, it, expect } from "vitest";
import { REGEX_PRIMER_SECTIONS } from "@/components/search/regexPrimer";
import { parseSearchQuery, tokenizeQuery, findOperatorConfig, parseRegexValue } from "@/lib/search";

/**
 * Guard the primer against drift: every clickable example must keep parsing
 * against the real engine, use only registered operators, and any slash-
 * delimited value must actually be a valid regex (not silently falling back to
 * a literal match).
 */
describe("REGEX_PRIMER_SECTIONS", () => {
  const examples = REGEX_PRIMER_SECTIONS.flatMap((section) =>
    section.entries.flatMap((entry) => entry.examples)
  );

  it("has examples", () => {
    expect(examples.length).toBeGreaterThan(10);
  });

  it("every example parses to a non-empty Mongo filter", () => {
    for (const example of examples) {
      const filter = parseSearchQuery(example);
      expect(Object.keys(filter).length, `example "${example}" parsed to {}`).toBeGreaterThan(0);
    }
  });

  it("every example uses only registered operators", () => {
    for (const example of examples) {
      for (const token of tokenizeQuery(example)) {
        if (["(", ")", "or"].includes(token.toLowerCase())) continue;
        const bare = token.startsWith("-") ? token.slice(1) : token;
        const keyMatch = bare.match(/^(\w+)[:<>=!]/);
        if (!keyMatch) continue;
        expect(
          findOperatorConfig(keyMatch[1]),
          `example "${example}" uses unknown operator "${keyMatch[1]}"`
        ).not.toBeNull();
      }
    }
  });

  it("every slash-delimited value is a valid regex (no literal fallback)", () => {
    for (const example of examples) {
      for (const token of tokenizeQuery(example)) {
        const colonIndex = token.indexOf(":");
        if (colonIndex === -1) continue;
        const value = token.slice(colonIndex + 1);
        if (!value.startsWith("/")) continue;
        expect(
          parseRegexValue(value),
          `example "${example}" has an invalid regex value "${value}"`
        ).toBeInstanceOf(RegExp);
      }
    }
  });
});

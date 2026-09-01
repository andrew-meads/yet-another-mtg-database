import { describe, it, expect } from "vitest";
import {
  buildSearchTranslatorSystemPrompt,
  parseTranslateSearchResult,
  SEARCH_TRANSLATOR_EXAMPLES
} from "@/lib/ai/agents/searchTranslator";
import { parseSearchQuery, tokenizeQuery, findOperatorConfig } from "@/lib/search";

describe("parseTranslateSearchResult", () => {
  it("parses a plain JSON object", () => {
    expect(parseTranslateSearchResult('{"query": "t:goblin c:r", "notes": "hi"}')).toEqual({
      query: "t:goblin c:r",
      notes: "hi"
    });
  });

  it("parses JSON without notes", () => {
    expect(parseTranslateSearchResult('{"query": "mv<=2"}')).toEqual({ query: "mv<=2" });
  });

  it("tolerates markdown code fences", () => {
    const text = '```json\n{"query": "t:elf"}\n```';
    expect(parseTranslateSearchResult(text)).toEqual({ query: "t:elf" });
  });

  it("tolerates surrounding prose", () => {
    const text = 'Sure! Here you go: {"query": "c:blue o:flying"} Hope that helps.';
    expect(parseTranslateSearchResult(text)).toEqual({ query: "c:blue o:flying" });
  });

  it("throws when there is no JSON object", () => {
    expect(() => parseTranslateSearchResult("t:goblin c:r")).toThrow(/JSON/);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseTranslateSearchResult('{"query": "t:goblin",}')).toThrow(/malformed/i);
  });

  it("throws when the query field is missing or empty", () => {
    expect(() => parseTranslateSearchResult('{"notes": "no query"}')).toThrow(/shape/);
    expect(() => parseTranslateSearchResult('{"query": ""}')).toThrow(/shape/);
  });
});

describe("buildSearchTranslatorSystemPrompt", () => {
  it("embeds the syntax cheat sheet and the output contract", () => {
    const prompt = buildSearchTranslatorSystemPrompt();
    expect(prompt).toContain("## Basics");
    expect(prompt).toContain('{"query"');
    expect(prompt).toContain("ONLY the operators documented above");
  });

  it("embeds the oracle-text conventions and the worked examples", () => {
    const prompt = buildSearchTranslatorSystemPrompt();
    expect(prompt).toContain("LITERAL SUBSTRING");
    expect(prompt).toContain('o:"{t}: add"');
    for (const example of SEARCH_TRANSLATOR_EXAMPLES) {
      expect(prompt).toContain(example.request);
    }
  });
});

describe("SEARCH_TRANSLATOR_EXAMPLES", () => {
  // Guard against operator drift: every key used in a worked example must be a
  // registered operator, and every example must produce a real Mongo filter.
  const GRAMMAR_TOKENS = new Set(["(", ")", "or"]);

  it("uses only registered operators", () => {
    for (const { query } of SEARCH_TRANSLATOR_EXAMPLES) {
      for (const token of tokenizeQuery(query)) {
        if (GRAMMAR_TOKENS.has(token.toLowerCase())) continue;
        const bare = token.startsWith("-") ? token.slice(1) : token;
        const keyMatch = bare.match(/^(\w+)[:<>=!]/);
        if (!keyMatch) continue; // bare name term
        expect(
          findOperatorConfig(keyMatch[1]),
          `example "${query}" uses unknown operator "${keyMatch[1]}"`
        ).not.toBeNull();
      }
    }
  });

  it("produces a non-empty Mongo filter for every example", () => {
    for (const { query } of SEARCH_TRANSLATOR_EXAMPLES) {
      const filter = parseSearchQuery(query);
      expect(Object.keys(filter).length, `example "${query}" parsed to {}`).toBeGreaterThan(0);
    }
  });
});

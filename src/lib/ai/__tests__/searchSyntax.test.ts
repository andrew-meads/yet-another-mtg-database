import { describe, it, expect } from "vitest";
import { buildSearchSyntaxCheatSheet } from "@/lib/ai/prompts/searchSyntax";
import { searchOperators, findOperatorConfig } from "@/lib/search/config";
import { SEARCH_DOC_SECTIONS } from "@/components/search/searchDocs";

/**
 * Pseudo-syntax rows in the docs (query grammar, not `key:value` operators).
 * These intentionally have no entry in `searchOperators`.
 */
const GRAMMAR_TOKENS = new Set(["word", '"…"', "a b", "or", "( … )", "-"]);

describe("buildSearchSyntaxCheatSheet", () => {
  const sheet = buildSearchSyntaxCheatSheet();

  it("covers every registered search operator", () => {
    // Every operator in config.ts must be documented under at least one of its
    // aliases — otherwise the LLM prompt has drifted from the real engine.
    for (const [name, config] of Object.entries(searchOperators)) {
      const documented = config.aliases.some(
        (alias) => sheet.includes(`\`${alias}\``) || sheet.includes(`aliases: ${alias}`) ||
          sheet.includes(`${alias},`) || sheet.includes(`, ${alias}`)
      );
      expect(documented, `operator "${name}" (${config.aliases.join(", ")}) missing`).toBe(true);
    }
  });

  it("documents only syntaxes the engine actually supports", () => {
    for (const section of SEARCH_DOC_SECTIONS) {
      for (const entry of section.entries) {
        if (!entry.syntax || GRAMMAR_TOKENS.has(entry.syntax)) continue;
        expect(
          findOperatorConfig(entry.syntax),
          `documented syntax "${entry.syntax}" is not a registered operator`
        ).not.toBeNull();
        for (const alias of entry.aliases ?? []) {
          expect(
            findOperatorConfig(alias),
            `documented alias "${alias}" is not a registered operator`
          ).not.toBeNull();
        }
      }
    }
  });

  it("includes section titles and examples", () => {
    expect(sheet).toContain("## Basics");
    expect(sheet).toContain("t:creature");
  });
});

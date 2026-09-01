import { tool } from "ai";
import { z } from "zod";
import { lookupRules } from "@/lib/server/rulesLookup";
import { ToolContext, safeExecute } from "./shared";

const inputSchema = z.object({
  kind: z
    .enum(["rule", "glossary"])
    .describe(
      '"rule" to look up a Comprehensive Rules rule by number (e.g. "702.19b"), "glossary" to look up a keyword or glossary term by name (e.g. "trample", "scry")'
    ),
  query: z.string().min(1).describe("The rule number or keyword/term to look up")
});

/**
 * Comprehensive Rules lookups via the Academy Ruins API (24h cached). Covers
 * rule-by-number and keyword/glossary definitions.
 */
export function makeLookupRuleTool(_ctx: ToolContext) {
  return tool({
    description:
      "Look up the Magic Comprehensive Rules: a specific rule by number, or a keyword ability/action or glossary term by name. Returns the official rule text (with printed examples when available). Use for general rules questions; use getRulings for card-specific rulings.",
    inputSchema,
    execute: safeExecute("lookupRule", async ({ kind, query }: z.infer<typeof inputSchema>) => {
      const result = await lookupRules(kind, query);
      if (result.notFound) {
        return { error: `No ${kind === "rule" ? "rule" : "keyword or glossary entry"} found for "${query}"` };
      }
      return result;
    })
  });
}

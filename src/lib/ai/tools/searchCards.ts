import { tool } from "ai";
import { z } from "zod";
import { runCardSearch } from "@/lib/server/cardSearch";
import { slimCardForLlm } from "@/lib/ai/slim";
import { ToolContext, TOOL_RESULT_CARD_CAP, safeExecute } from "./shared";

const inputSchema = z.object({
  q: z
    .string()
    .min(1)
    .describe(
      'Scryfall-style search query, e.g. \'t:creature c:g mv<=2 o:"add {g}"\'. Same syntax as the app search bar.'
    ),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based results page (20 results per page); defaults to 1")
});

/**
 * Hard cap per query so a pathological search aborts (surfaced in-band via
 * safeExecute) instead of hanging the chat turn indefinitely.
 */
const SEARCH_MAX_TIME_MS = 15_000;

async function searchWithOptions(q: string, page: number, ownerId?: string) {
  const { cards, total, totalPages, hasMore } = await runCardSearch({
    queryString: q,
    page,
    pageLen: TOOL_RESULT_CARD_CAP,
    order: "name",
    dir: "asc",
    owned: ownerId !== undefined,
    ownerId,
    maxTimeMS: SEARCH_MAX_TIME_MS
  });

  return {
    total,
    page,
    totalPages,
    hasMore,
    cards: cards.map((card) => slimCardForLlm(card))
  };
}

/**
 * Search the full card database (every printed card, owned or not) with the
 * app's Scryfall-style query engine.
 */
export function makeSearchCardsTool(_ctx: ToolContext) {
  return tool({
    description:
      "Search the ENTIRE card database (all printed Magic cards, not just cards the user owns) with a Scryfall-style query. Returns up to 20 cards per page with oracle text, plus the total match count. Use searchMyCards instead when the user asks about cards they own.",
    inputSchema,
    execute: safeExecute("searchCards", async ({ q, page }: z.infer<typeof inputSchema>) =>
      searchWithOptions(q, page ?? 1)
    )
  });
}

/**
 * The same search restricted to cards the user owns at least one physical copy
 * of (any collection or deck) — owner-scoped, unlike the app-wide owned filter.
 */
export function makeSearchMyCardsTool({ userId }: ToolContext) {
  return tool({
    description:
      "Search only the cards the USER OWNS (at least one physical copy in any of their collections or decks) with a Scryfall-style query. Returns up to 20 cards per page plus the total match count. Ideal for 'what do I own that…' questions and finding alternatives the user already has.",
    inputSchema,
    execute: safeExecute("searchMyCards", async ({ q, page }: z.infer<typeof inputSchema>) =>
      searchWithOptions(q, page ?? 1, userId)
    )
  });
}

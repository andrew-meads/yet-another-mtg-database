import { tool } from "ai";
import { z } from "zod";
import { getCardRulings } from "@/lib/server/cardRulings";
import { ToolContext, findCardByName, safeExecute } from "./shared";

const inputSchema = z.object({
  cardName: z.string().min(1).describe("Exact name of the card to fetch official rulings for")
});

/** Cap on rulings returned per card (some cards have dozens). */
const RULINGS_CAP = 20;

/**
 * Official Scryfall/WotC rulings for a named card, served from the 7-day
 * `cardrulings` cache.
 */
export function makeGetRulingsTool(_ctx: ToolContext) {
  return tool({
    description:
      "Get the official rulings for a card by exact name (rules clarifications published by Wizards of the Coast). Use for 'how does X work' or interaction questions about a specific card.",
    inputSchema,
    execute: safeExecute("getRulings", async ({ cardName }: z.infer<typeof inputSchema>) => {
      const card = await findCardByName(cardName);
      if (!card) return { error: `Unknown card "${cardName}"` };

      const rulings = await getCardRulings(card.id);
      return {
        cardName: card.name,
        totalRulings: rulings.length,
        truncated: rulings.length > RULINGS_CAP || undefined,
        rulings: rulings
          .slice(0, RULINGS_CAP)
          .map((r) => ({ published_at: r.published_at, comment: r.comment }))
      };
    })
  });
}

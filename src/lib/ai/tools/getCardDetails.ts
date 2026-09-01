import { tool } from "ai";
import { z } from "zod";
import { getCardPrices } from "@/lib/server/cardPrices";
import { slimCardForLlm, LlmCard } from "@/lib/ai/slim";
import { ToolContext, findCardByName, safeExecute } from "./shared";

const inputSchema = z.object({
  names: z
    .array(z.string().min(1))
    .min(1)
    .max(6)
    .describe("Exact card names to look up (up to 6 per call)")
});

/**
 * Full oracle text + current prices for specific named cards. Name matching is
 * exact (case-insensitive), including face and flavor names; the newest
 * printing is returned.
 */
export function makeGetCardDetailsTool(_ctx: ToolContext) {
  return tool({
    description:
      "Get the full details of specific cards by exact name: oracle text, mana cost, types, stats, and current prices (USD/EUR/MTGO tix). Use this when discussing or recommending a specific card. Prices may be unavailable for some printings.",
    inputSchema,
    execute: safeExecute("getCardDetails", async ({ names }: z.infer<typeof inputSchema>) => {
      const found: LlmCard[] = [];
      const notFound: string[] = [];

      for (const name of names) {
        const card = await findCardByName(name);
        if (card) found.push(slimCardForLlm(card));
        else notFound.push(name);
      }

      // Prices are best-effort — a Scryfall hiccup must not sink the details.
      try {
        const prices = await getCardPrices(found.map((c) => c.id));
        for (const card of found) {
          if (prices[card.id]) card.prices = prices[card.id];
        }
      } catch (error) {
        console.error("getCardDetails: price lookup failed:", error);
      }

      return {
        cards: found,
        notFound: notFound.length > 0 ? notFound : undefined
      };
    })
  });
}

import { tool } from "ai";
import { z } from "zod";
import { DeckModel, PhysicalCardModel, CardData } from "@/db/schema";
import { analyzeManaBase, ManaBaseCard } from "@/lib/ai/manaBase";
import { ToolContext, isValidObjectId, safeExecute } from "./shared";

/* eslint-disable @typescript-eslint/no-explicit-any */

const inputSchema = z.object({
  deckId: z.string().describe("The id of the deck to analyze"),
  sectionName: z
    .string()
    .optional()
    .describe(
      "Analyze only this deck section (case-insensitive name match), e.g. to exclude a sideboard. Omit to analyze the whole deck."
    )
});

const MANA_BASE_PROJECTION = {
  _id: 0,
  id: 1,
  name: 1,
  type_line: 1,
  cmc: 1,
  mana_cost: 1,
  oracle_text: 1,
  produced_mana: 1,
  "card_faces.mana_cost": 1,
  "card_faces.oracle_text": 1
} as const;

/**
 * Deterministic mana-base statistics for a deck: land count, color sources,
 * pip demand, curve, and a sources-vs-pips table. The numbers are computed in
 * code (src/lib/ai/manaBase.ts) — the LLM interprets them, it never counts.
 */
export function makeManaBaseStatsTool({ userId }: ToolContext) {
  return tool({
    description:
      "Compute exact mana-base statistics for one of the user's decks: land/nonland counts, how many cards produce each color of mana (overall and lands only), colored-pip demand across nonland mana costs, the mana curve, average mana value, and a per-color sources-vs-pips comparison. ALWAYS use this instead of counting cards yourself.",
    inputSchema,
    execute: safeExecute(
      "manaBaseStats",
      async ({ deckId, sectionName }: z.infer<typeof inputSchema>) => {
        if (!isValidObjectId(deckId)) return { error: "Invalid deck id" };

        const deck = await DeckModel.findOne({ _id: deckId, owner: userId }).lean();
        if (!deck) return { error: "Deck not found" };

        let physical;
        if (sectionName) {
          const section = (deck.sections as any[]).find(
            (s) => s.name.toLowerCase() === sectionName.trim().toLowerCase()
          );
          if (!section) {
            return {
              error: `No section named "${sectionName}". Sections: ${(deck.sections as any[])
                .map((s) => s.name)
                .join(", ")}`
            };
          }
          const physicalIds = (section.columns ?? []).flatMap((col: any) => col.cards ?? []);
          physical = await PhysicalCardModel.find(
            { _id: { $in: physicalIds }, owner: userId },
            { cardId: 1 }
          ).lean();
        } else {
          // Whole deck: the deckId back-ref is the membership source of truth.
          physical = await PhysicalCardModel.find({ deckId, owner: userId }, { cardId: 1 }).lean();
        }

        if (physical.length === 0) {
          return { error: sectionName ? "That section is empty" : "That deck is empty" };
        }

        const cardIds = [...new Set(physical.map((pc) => pc.cardId))];
        const cards = await CardData.find({ id: { $in: cardIds } }, MANA_BASE_PROJECTION).lean();
        const byId = new Map(cards.map((c: any) => [c.id, c as unknown as ManaBaseCard]));

        // One element per physical copy so counts are exact.
        const copies = physical
          .map((pc) => byId.get(pc.cardId))
          .filter((c): c is ManaBaseCard => Boolean(c));

        return {
          deckName: deck.name,
          scope: sectionName ?? "whole deck",
          stats: analyzeManaBase(copies)
        };
      }
    )
  });
}

import { tool } from "ai";
import { z } from "zod";
import { DeckModel, PhysicalCardModel, CardData } from "@/db/schema";
import { findCombosForNames } from "@/lib/server/comboSearch";
import { ToolContext, isValidObjectId, safeExecute } from "./shared";

const inputSchema = z.object({
  deckId: z.string().describe("The id of the deck to find combos in")
});

/**
 * Card-combo detection for a deck via the Commander Spellbook database:
 * combos the deck already contains, and combos it is one or two cards away
 * from completing.
 */
export function makeFindCombosTool({ userId }: ToolContext) {
  return tool({
    description:
      "Find card combos in one of the user's decks using the Commander Spellbook database. Returns combos fully present in the deck (with what they produce and how they work) and combos the deck is nearly able to run, with the missing cards. Use for 'what combos does my deck have' or when hunting for synergy upgrades.",
    inputSchema,
    execute: safeExecute("findCombos", async ({ deckId }: z.infer<typeof inputSchema>) => {
      if (!isValidObjectId(deckId)) return { error: "Invalid deck id" };

      const deck = await DeckModel.findOne({ _id: deckId, owner: userId }, { name: 1 }).lean();
      if (!deck) return { error: "Deck not found" };

      const cardIds = await PhysicalCardModel.distinct("cardId", { deckId, owner: userId });
      if (cardIds.length === 0) return { error: "That deck is empty" };

      const cards = await CardData.find({ id: { $in: cardIds } }, { _id: 0, name: 1 }).lean();
      // Multi-faced names are stored as "Front // Back"; Spellbook matches the
      // full name fine, so send them as-is (deduplicated).
      const names = [...new Set(cards.map((c) => c.name))];

      const combos = await findCombosForNames(names);
      return { deckName: deck.name, ...combos };
    })
  });
}

import { tool } from "ai";
import { z } from "zod";
import { DeckModel, PhysicalCardModel, CardData } from "@/db/schema";
import { serializeDeck, SerializableCard, SerializableSection } from "@/lib/ai/prompts/deckSerialize";
import { ToolContext, isValidObjectId, safeExecute } from "./shared";

/* eslint-disable @typescript-eslint/no-explicit-any */

const inputSchema = z.object({
  deckId: z.string().describe("The id of the deck to read")
});

/**
 * Read one of the user's decks as a compact, section-by-section decklist
 * ("4x Forest [neo]" lines). Membership comes from the PhysicalCard back-refs;
 * copies not yet placed in the arrangement arrays appear under "(unsorted)".
 */
export function makeReadDeckTool({ userId }: ToolContext) {
  return tool({
    description:
      "Read one of the user's decks: its name, description, and full decklist grouped by section with copy counts, mana costs, and type lines. Use this before answering any question about a specific deck.",
    inputSchema,
    execute: safeExecute("readDeck", async ({ deckId }: z.infer<typeof inputSchema>) => {
      if (!isValidObjectId(deckId)) return { error: "Invalid deck id" };

      const deck = await DeckModel.findOne({ _id: deckId, owner: userId }).lean();
      if (!deck) return { error: "Deck not found" };

      const physical = await PhysicalCardModel.find({ deckId, owner: userId }).lean();
      const byPhysicalId = new Map(physical.map((pc) => [String(pc._id), pc]));

      // Sections come from the deck's arrangement arrays; any back-ref copy
      // missing from them (mid-failure recovery) is listed as unsorted.
      const arranged = new Set<string>();
      const sections: SerializableSection[] = (deck.sections as any[]).map((s) => {
        const cardIds: string[] = [];
        for (const col of s.columns ?? []) {
          for (const pid of col.cards ?? []) {
            const pc = byPhysicalId.get(String(pid));
            if (!pc) continue;
            arranged.add(String(pid));
            cardIds.push(pc.cardId);
          }
        }
        return { name: s.name, cardIds };
      });

      const unsorted = physical.filter((pc) => !arranged.has(String(pc._id)));
      if (unsorted.length > 0) {
        sections.push({ name: "(unsorted)", cardIds: unsorted.map((pc) => pc.cardId) });
      }

      const cardIds = [...new Set(physical.map((pc) => pc.cardId))];
      const cards = await CardData.find(
        { id: { $in: cardIds } },
        { _id: 0, id: 1, name: 1, set: 1, mana_cost: 1, type_line: 1 }
      ).lean();
      const cardData: Record<string, SerializableCard> = {};
      for (const c of cards) cardData[c.id] = c as unknown as SerializableCard;

      const ephemeralCount = physical.filter((pc) => !pc.collectionId).length;

      return {
        deckId,
        name: deck.name,
        description: deck.description || undefined,
        totalCards: physical.length,
        ephemeralPlaceholders: ephemeralCount > 0 ? ephemeralCount : undefined,
        decklist: serializeDeck(deck.name, sections, cardData)
      };
    })
  });
}

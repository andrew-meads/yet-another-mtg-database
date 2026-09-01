import { tool } from "ai";
import { z } from "zod";
import { CollectionModel, PhysicalCardModel, CardData } from "@/db/schema";
import { parseSearchQuery } from "@/lib/search/queryBuilder";
import { serializeCardList, SerializableCard } from "@/lib/ai/prompts/deckSerialize";
import { ToolContext, TOOL_RESULT_CARD_CAP, isValidObjectId, safeExecute } from "./shared";

const inputSchema = z.object({
  collectionId: z.string().describe("The id of the collection to read"),
  q: z
    .string()
    .optional()
    .describe(
      "Optional Scryfall-style search query to filter the collection (e.g. 't:creature c:g'). Without it only counts and a small sample are returned — collections can hold thousands of cards, so ALWAYS pass a query when looking for specific cards."
    )
});

/**
 * Read a collection as counts plus a q-scoped slice. Never dumps the whole
 * collection (a 9k-card collection would blow the context) — the result caps
 * distinct cards and reports totals so the model knows what it didn't see.
 */
export function makeReadCollectionTool({ userId }: ToolContext) {
  return tool({
    description:
      "Read one of the user's collections: total size plus a list of cards matching an optional Scryfall-style query, with copy counts. Results are capped, so use a focused query rather than browsing.",
    inputSchema,
    execute: safeExecute(
      "readCollection",
      async ({ collectionId, q }: z.infer<typeof inputSchema>) => {
        if (!isValidObjectId(collectionId)) return { error: "Invalid collection id" };

        const collection = await CollectionModel.findOne({
          _id: collectionId,
          owner: userId
        }).lean();
        if (!collection) return { error: "Collection not found" };

        const filter: Record<string, unknown> = { collectionId, owner: userId };
        const totalCopies = await PhysicalCardModel.countDocuments(filter);

        // Resolve the query against CardData first (intersected with the ids
        // present here) so only matching copies are ever loaded — the same
        // pattern as GET /api/collections/[id]?q=.
        if (q && q.trim().length > 0) {
          const searchQuery = parseSearchQuery(q);
          const allCardIds: string[] = await PhysicalCardModel.distinct("cardId", filter);
          const matches = await CardData.find(
            { $and: [searchQuery, { id: { $in: allCardIds } }] },
            { _id: 0, id: 1 }
          ).lean();
          filter.cardId = { $in: matches.map((m) => m.id) };
        }

        const copies = await PhysicalCardModel.find(filter, { cardId: 1 }).lean();
        const matchedCopies = copies.length;

        // Cap distinct cards, keeping full copy counts for the ones we show.
        const countsByCard = new Map<string, number>();
        for (const pc of copies) {
          countsByCard.set(pc.cardId, (countsByCard.get(pc.cardId) ?? 0) + 1);
        }
        const distinctCards = countsByCard.size;
        const shownIds = [...countsByCard.keys()].slice(0, TOOL_RESULT_CARD_CAP);

        const cards = await CardData.find(
          { id: { $in: shownIds } },
          { _id: 0, id: 1, name: 1, set: 1, mana_cost: 1, type_line: 1 }
        ).lean();
        const cardData: Record<string, SerializableCard> = {};
        for (const c of cards) cardData[c.id] = c as unknown as SerializableCard;

        const shownLines: string[] = [];
        for (const id of shownIds) {
          shownLines.push(...Array(countsByCard.get(id) ?? 1).fill(id));
        }

        return {
          collectionId,
          name: collection.name,
          totalCopies,
          matchedCopies: q ? matchedCopies : undefined,
          distinctCards,
          shownDistinctCards: shownIds.length,
          truncated: distinctCards > shownIds.length || undefined,
          cards: serializeCardList(shownLines, cardData)
        };
      }
    )
  });
}

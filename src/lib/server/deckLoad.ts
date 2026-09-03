import { DeckModel, PhysicalCardModel } from "@/db/schema";
import { DeckWithCardEntries } from "@/types/Deck";
import { CardDataMap } from "@/types/PhysicalCard";
import { detailPhysicalCards } from "./cardDetails";
import { findOrCreateColumn } from "./deckArrange";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface LoadedDeck {
  deck: DeckWithCardEntries;
  cardData: CardDataMap;
}

/**
 * Loads a user's deck as the nested section/column arrangement of detailed
 * physical-card entries plus the deduplicated card-data map — the same shape
 * `GET /api/decks/[id]?details=true` returns. Shared by that route and the
 * export route.
 *
 * Reconciles the arrangement from the `deckId` back-ref first: any physical
 * card pointing at this deck but missing from the arrays is appended to a
 * default column (and persisted), so a mid-failure of an earlier mutation is
 * always recoverable.
 *
 * Returns null when the deck doesn't exist or isn't owned by `userId`.
 */
export async function loadDeckWithCards(
  deckId: string,
  userId: string
): Promise<LoadedDeck | null> {
  const deck = await DeckModel.findOne({ _id: deckId, owner: userId });
  if (!deck) return null;

  const summary = {
    _id: String(deck._id),
    name: deck.name,
    description: deck.description ?? "",
    isActive: deck.isActive ?? false,
    owner: String(deck.owner),
    kind: "deck" as const
  };

  // Reconcile: append any owned-by-this-deck cards missing from the arrangement.
  const arranged = new Set<string>();
  deck.sections.forEach((s: any) =>
    s.columns.forEach((col: any) => col.cards.forEach((cid: any) => arranged.add(String(cid))))
  );
  const owned = await PhysicalCardModel.find({ deckId, owner: userId }, { _id: 1 }).lean();
  const orphanIds = owned.map((o) => o._id).filter((oid) => !arranged.has(String(oid)));
  if (orphanIds.length > 0) {
    const column = findOrCreateColumn(deck);
    column.cards.push(...orphanIds);
    deck.markModified("sections");
    await deck.save();
  }

  // Gather all arranged ids and detail them.
  const allIds: string[] = [];
  deck.sections.forEach((s: any) =>
    s.columns.forEach((col: any) => col.cards.forEach((cid: any) => allIds.push(String(cid))))
  );
  const physicalCards = await PhysicalCardModel.find({
    _id: { $in: allIds },
    owner: userId
  }).lean();
  const { entries, cardData } = await detailPhysicalCards(physicalCards);
  const entryMap = new Map(entries.map((d) => [d._id, d]));

  const deckWithCards: DeckWithCardEntries = {
    ...summary,
    sections: deck.sections.map((s: any) => ({
      _id: String(s._id),
      name: s.name,
      columns: s.columns.map((col: any) => ({
        _id: String(col._id),
        cards: col.cards
          .map((cid: any) => entryMap.get(String(cid)))
          .filter((c: any): c is NonNullable<typeof c> => Boolean(c))
      }))
    }))
  };

  return { deck: deckWithCards, cardData };
}

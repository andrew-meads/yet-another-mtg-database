import { CardData, CollectionModel, DeckModel, TagModel } from "@/db/schema";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { MtgCard } from "@/types/MtgCard";

/** Minimal shape of a lean PhysicalCard document used for detailing. */
export interface LeanPhysicalCard {
  _id: unknown;
  cardId: string;
  /** Null/absent for ephemeral (deck-only) cards. */
  collectionId?: unknown;
  deckId?: unknown;
  notes?: string;
  tags?: string[];
}

/**
 * Joins a list of physical cards with their Scryfall card data and resolves the
 * collection/deck names used for the cross-membership badges.
 */
export async function detailPhysicalCards(
  cards: LeanPhysicalCard[]
): Promise<DetailedPhysicalCard[]> {
  if (cards.length === 0) return [];

  const cardIds = [...new Set(cards.map((c) => c.cardId))];
  // Ephemeral cards have a null collectionId — exclude them from the lookup.
  const collectionIds = [
    ...new Set(cards.filter((c) => c.collectionId).map((c) => String(c.collectionId)))
  ];
  const deckIds = [...new Set(cards.filter((c) => c.deckId).map((c) => String(c.deckId)))];

  const [mtgCards, collections, decks] = await Promise.all([
    CardData.find({ id: { $in: cardIds } }).lean(),
    CollectionModel.find({ _id: { $in: collectionIds } }, { name: 1 }).lean(),
    deckIds.length
      ? DeckModel.find({ _id: { $in: deckIds } }, { name: 1 }).lean()
      : Promise.resolve([])
  ]);

  const cardMap = new Map(mtgCards.map((c) => [c.id, c as unknown as MtgCard]));
  const collMap = new Map(collections.map((c) => [String(c._id), c.name]));
  const deckMap = new Map(decks.map((d) => [String(d._id), d.name]));

  return cards
    .map((pc): DetailedPhysicalCard | null => {
      const card = cardMap.get(pc.cardId);
      if (!card) return null;
      const isEphemeral = !pc.collectionId;
      return {
        _id: String(pc._id),
        card,
        collectionId: isEphemeral ? null : String(pc.collectionId),
        deckId: pc.deckId ? String(pc.deckId) : null,
        notes: pc.notes,
        tags: pc.tags,
        isEphemeral,
        collectionName: isEphemeral ? undefined : collMap.get(String(pc.collectionId)),
        deckName: pc.deckId ? deckMap.get(String(pc.deckId)) : undefined
      };
    })
    .filter((c): c is DetailedPhysicalCard => c !== null);
}

/**
 * Adds any tags not already present to the Tag database.
 */
export async function upsertTags(tags?: string[]) {
  if (!Array.isArray(tags) || tags.length === 0) return;
  const existing = await TagModel.find({ label: { $in: tags } }, { label: 1, _id: 0 }).lean();
  const existingLabels = new Set(existing.map((t: { label: string }) => t.label));
  const newLabels = tags.filter((label) => !existingLabels.has(label));
  if (newLabels.length > 0) {
    await TagModel.insertMany(
      newLabels.map((label) => ({ label })),
      { ordered: false }
    );
  }
}

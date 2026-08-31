import { CardData, CollectionModel, DeckModel, TagModel } from "@/db/schema";
import { CardDataMap, DetailedPhysicalCardEntry } from "@/types/PhysicalCard";
import { SlimMtgCard } from "@/types/MtgCard";

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
 * Projection applied to the card data served by the detail endpoints: only the
 * fields the client actually renders (mirrors SlimMtgCard in
 * src/types/MtgCard.ts — extend BOTH when a component starts reading a new card
 * field). Notably drops the unused png/border_crop/art_crop image variants and
 * Mongo's _id/__v.
 */
export const SLIM_CARD_PROJECTION = {
  _id: 0,
  id: 1,
  name: 1,
  flavor_name: 1,
  layout: 1,
  oracle_id: 1,
  mana_cost: 1,
  cmc: 1,
  type_line: 1,
  oracle_text: 1,
  flavor_text: 1,
  power: 1,
  toughness: 1,
  loyalty: 1,
  set: 1,
  set_name: 1,
  collector_number: 1,
  rarity: 1,
  "image_uris.small": 1,
  "image_uris.normal": 1,
  "image_uris.large": 1,
  "card_faces.name": 1,
  "card_faces.mana_cost": 1,
  "card_faces.type_line": 1,
  "card_faces.oracle_text": 1,
  "card_faces.flavor_text": 1,
  "card_faces.power": 1,
  "card_faces.toughness": 1,
  "card_faces.loyalty": 1,
  "card_faces.image_uris.small": 1,
  "card_faces.image_uris.normal": 1,
  "card_faces.image_uris.large": 1
} as const;

export interface DetailedPhysicalCardsResult {
  /** One entry per physical copy, referencing its card by Scryfall id. */
  entries: DetailedPhysicalCardEntry[];
  /** Deduplicated slim card data for every cardId referenced by the entries. */
  cardData: CardDataMap;
}

/**
 * Resolves a list of physical cards into wire-ready entries plus a deduplicated
 * card-data map (the card data is NOT embedded per copy — the client re-joins),
 * and resolves the collection/deck names used for the cross-membership badges.
 */
export async function detailPhysicalCards(
  cards: LeanPhysicalCard[]
): Promise<DetailedPhysicalCardsResult> {
  if (cards.length === 0) return { entries: [], cardData: {} };

  const cardIds = [...new Set(cards.map((c) => c.cardId))];
  // Ephemeral cards have a null collectionId — exclude them from the lookup.
  const collectionIds = [
    ...new Set(cards.filter((c) => c.collectionId).map((c) => String(c.collectionId)))
  ];
  const deckIds = [...new Set(cards.filter((c) => c.deckId).map((c) => String(c.deckId)))];

  const [mtgCards, collections, decks] = await Promise.all([
    CardData.find({ id: { $in: cardIds } }, SLIM_CARD_PROJECTION).lean(),
    CollectionModel.find({ _id: { $in: collectionIds } }, { name: 1 }).lean(),
    deckIds.length
      ? DeckModel.find({ _id: { $in: deckIds } }, { name: 1 }).lean()
      : Promise.resolve([])
  ]);

  const cardData: CardDataMap = {};
  for (const c of mtgCards) cardData[c.id] = c as unknown as SlimMtgCard;
  const collMap = new Map(collections.map((c) => [String(c._id), c.name]));
  const deckMap = new Map(decks.map((d) => [String(d._id), d.name]));

  const entries = cards
    .map((pc): DetailedPhysicalCardEntry | null => {
      if (!cardData[pc.cardId]) return null;
      const isEphemeral = !pc.collectionId;
      return {
        _id: String(pc._id),
        cardId: pc.cardId,
        collectionId: isEphemeral ? null : String(pc.collectionId),
        deckId: pc.deckId ? String(pc.deckId) : null,
        notes: pc.notes,
        tags: pc.tags,
        isEphemeral,
        collectionName: isEphemeral ? undefined : collMap.get(String(pc.collectionId)),
        deckName: pc.deckId ? deckMap.get(String(pc.deckId)) : undefined
      };
    })
    .filter((c): c is DetailedPhysicalCardEntry => c !== null);

  return { entries, cardData };
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

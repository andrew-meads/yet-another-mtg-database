import { MtgCard } from "./MtgCard";

/**
 * A single physical card copy.
 *
 * A physical card belongs to at most one collection (`collectionId`) and is
 * optionally assigned to at most one deck (`deckId`). These back-references are
 * the source of truth for membership. A card with `collectionId === null` is
 * **ephemeral**: it lives only inside its deck and is deleted when removed from it.
 */
export interface PhysicalCard {
  _id: string;
  owner: string;
  /** Scryfall id of the card (references CardData.id) */
  cardId: string;
  /** Owning collection, or null/undefined for an ephemeral (deck-only) card. */
  collectionId?: string | null;
  deckId?: string | null;
  notes?: string;
  tags?: string[];
}

/**
 * A physical card joined with its Scryfall card data and cross-membership labels
 * used for badges (which deck a collection-card is in, and vice versa).
 */
export interface DetailedPhysicalCard {
  _id: string;
  card: MtgCard;
  /** Owning collection, or null for an ephemeral (deck-only) card. */
  collectionId: string | null;
  deckId?: string | null;
  notes?: string;
  tags?: string[];
  /** True when this is an ephemeral (deck-only) card with no collection. */
  isEphemeral?: boolean;
  /** Name of the collection this card belongs to (for the deck view badge) */
  collectionName?: string;
  /** Name of the deck this card is assigned to, if any (for the collection table badge) */
  deckName?: string;
}

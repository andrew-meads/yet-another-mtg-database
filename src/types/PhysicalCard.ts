import { MtgCard } from "./MtgCard";

/**
 * A single physical card copy.
 *
 * Every physical card belongs to exactly one collection (`collectionId`) and is
 * optionally assigned to at most one deck (`deckId`). These back-references are
 * the source of truth for membership.
 */
export interface PhysicalCard {
  _id: string;
  owner: string;
  /** Scryfall id of the card (references CardData.id) */
  cardId: string;
  collectionId: string;
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
  collectionId: string;
  deckId?: string | null;
  notes?: string;
  tags?: string[];
  /** Name of the collection this card belongs to (for the deck view badge) */
  collectionName?: string;
  /** Name of the deck this card is assigned to, if any (for the collection table badge) */
  deckName?: string;
}

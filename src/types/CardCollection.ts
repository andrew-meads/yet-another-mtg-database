import { MtgCard } from "./MtgCard";

export type CollectionType = "collection" | "wishlist" | "deck";

export interface CollectionSummary {
  _id: string;
  name: string;
  collectionType: CollectionType;
  isActive?: boolean;
}

/**
 * Card entry in a collection
 */
export interface CardEntry {
  cardId: string;
  quantity: number;
  notes?: string;
  tags?: string[];
}

export interface CardCollection extends CollectionSummary {
  description: string;
  cards: Array<CardEntry>;
}

export interface DetailedCardEntry {
  card: MtgCard;
  quantity: number;
  notes?: string;
  tags?: string[];
}

export interface CardCollectionWithCards extends CardCollection {
  cardsDetailed: Array<DetailedCardEntry>;
}

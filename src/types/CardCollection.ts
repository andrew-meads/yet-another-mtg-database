import { MtgCard } from "./MtgCard";

export interface CardCollection {
  _id: string;
  name: string;
  collectionType: "collection" | "wishlist" | "deck";
  description: string;
  isActive?: boolean;
  cards: Array<{
    cardId: string;
    quantity: number;
    notes?: string;
    tags?: string[];
  }>;
}

export interface CardCollectionWithCards extends CardCollection {
  cardsDetailed: Array<{
    card: MtgCard;
    quantity: number;
    notes?: string;
    tags?: string[];
  }>;
}

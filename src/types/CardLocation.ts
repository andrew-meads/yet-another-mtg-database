import { DetailedCardEntry } from "./CardCollection";

export interface CardLocation {
  collectionId: string;
  collectionName: string;
  cards: Array<DetailedCardEntry>;
}

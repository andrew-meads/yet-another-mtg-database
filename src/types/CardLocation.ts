import { DetailedPhysicalCard, DetailedPhysicalCardEntry } from "./PhysicalCard";

export interface CardLocation {
  collectionId: string;
  collectionName: string;
  cards: Array<DetailedPhysicalCard>;
}

/** Wire form of CardLocation: entries reference cards by id; the response ships a CardDataMap alongside. */
export interface CardLocationEntries {
  collectionId: string;
  collectionName: string;
  cards: Array<DetailedPhysicalCardEntry>;
}

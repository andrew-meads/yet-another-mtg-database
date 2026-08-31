import { DetailedPhysicalCard, DetailedPhysicalCardEntry } from "./PhysicalCard";

export interface CollectionSummary {
  _id: string;
  name: string;
  kind: "collection";
  isActive?: boolean;
  owner: string;
}

export interface Collection extends CollectionSummary {
  description: string;
}

/** What GET /api/collections/summaries returns per collection: the summary plus description and live card count. */
export interface CollectionListSummary extends Collection {
  cardCount: number;
}

export interface CollectionWithCards extends Collection {
  /** Flat list of this collection's physical cards (client groups + sorts them) */
  cards: DetailedPhysicalCard[];
}

/** Wire form of CollectionWithCards: entries reference cards by id; the response ships a CardDataMap alongside. */
export interface CollectionWithCardEntries extends Collection {
  cards: DetailedPhysicalCardEntry[];
}

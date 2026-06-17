import { DetailedPhysicalCard } from "./PhysicalCard";

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

export interface CollectionWithCards extends Collection {
  /** Flat list of this collection's physical cards (client groups + sorts them) */
  cards: DetailedPhysicalCard[];
}

import { DetailedPhysicalCard } from "./PhysicalCard";
import { CollectionSummary } from "./Collection";

export interface DeckSummary {
  _id: string;
  name: string;
  kind: "deck";
  owner: string;
}

export interface Deck extends DeckSummary {
  description: string;
}

export interface DeckColumn {
  _id: string;
  cards: DetailedPhysicalCard[];
}

export interface DeckSection {
  _id: string;
  name: string;
  columns: DeckColumn[];
}

export interface DeckWithCards extends Deck {
  sections: DeckSection[];
}

/** A workspace-openable entity: either a collection or a deck. */
export type OpenEntitySummary = CollectionSummary | DeckSummary;

import { DetailedPhysicalCard, DetailedPhysicalCardEntry } from "./PhysicalCard";
import { CollectionSummary } from "./Collection";

export interface DeckSummary {
  _id: string;
  name: string;
  kind: "deck";
  isActive?: boolean;
  owner: string;
}

export interface Deck extends DeckSummary {
  description: string;
}

/**
 * What GET /api/decks returns per deck: the summary plus description and live
 * card counts. `cardCount` is the main deck only; sideboard copies are counted
 * separately and scratch-area copies not at all.
 */
export interface DeckListSummary extends Deck {
  cardCount: number;
  sideboardCount: number;
}

/**
 * How a section's cards count toward the deck: "normal" sections are the main
 * deck, "sideboard" sections count toward a separate sideboard total, and
 * "scratch" areas don't count at all. Stored sparsely: absent means "normal".
 */
export const DECK_SECTION_KINDS = ["normal", "sideboard", "scratch"] as const;
export type DeckSectionKind = (typeof DECK_SECTION_KINDS)[number];

export interface DeckColumn {
  _id: string;
  cards: DetailedPhysicalCard[];
}

export interface DeckSection {
  _id: string;
  name: string;
  /** Absent means "normal"; read through `effectiveSectionKind`. */
  kind?: DeckSectionKind;
  columns: DeckColumn[];
}

export interface DeckWithCards extends Deck {
  sections: DeckSection[];
}

/** Wire forms of the above: entries reference cards by id; the response ships a CardDataMap alongside. */
export interface DeckColumnEntries {
  _id: string;
  cards: DetailedPhysicalCardEntry[];
}

export interface DeckSectionEntries {
  _id: string;
  name: string;
  kind?: DeckSectionKind;
  columns: DeckColumnEntries[];
}

export interface DeckWithCardEntries extends Deck {
  sections: DeckSectionEntries[];
}

/** A workspace-openable entity: either a collection or a deck. */
export type OpenEntitySummary = CollectionSummary | DeckSummary;

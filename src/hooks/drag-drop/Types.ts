import { MtgCard } from "@/types/MtgCard";
import { OpenEntitySummary } from "@/types/Deck";

export const NEW_CARD = "NEW_CARD";
export const PHYSICAL_CARD = "PHYSICAL_CARD";

/** Dragged from search results — a brand new card to be added somewhere. */
export interface NewCardDragItem {
  kind: "new";
  card: MtgCard;
}

/** Where a physical-card drag originated (drives the drag layer + index recompute). */
export type PhysicalCardDragOrigin =
  | { type: "collection" }
  | { type: "deck"; sectionId: string; columnId: string };

/**
 * Dragged from a collection table row (one or more copies of a grouped row) or a
 * single deck stack image (exactly one id).
 */
export interface PhysicalCardDragItem {
  kind: "physical";
  /** One or more physical card ids; all share the same card, collection, and deck. */
  physicalCardIds: string[];
  card: MtgCard;
  sourceCollectionId: string;
  sourceDeckId?: string | null;
  origin: PhysicalCardDragOrigin;
}

export type AnyDragItem = NewCardDragItem | PhysicalCardDragItem;

/** A concrete drop destination handed to the dispatcher. */
export type DropTarget =
  | { kind: "collection"; collectionId: string }
  | { kind: "deck-column"; deckId: string; sectionId: string; columnId: string; index: number }
  | { kind: "deck-new-column"; deckId: string; sectionId: string }
  | { kind: "deck-new-section"; deckId: string }
  | { kind: "entity-button"; entity: OpenEntitySummary };

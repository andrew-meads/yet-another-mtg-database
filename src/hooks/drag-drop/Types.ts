import { MtgCard } from "@/types/MtgCard";
import { OpenEntitySummary } from "@/types/Deck";

export const NEW_CARD = "NEW_CARD";
export const PHYSICAL_CARD = "PHYSICAL_CARD";

/** Dragged from search results — a brand new card to be added somewhere. */
export interface NewCardDragItem {
  kind: "new";
  card: MtgCard;
  notes?: string;
  tags?: string[];
}

/** Where a physical-card drag originated (drives the drag layer + index recompute). */
export type PhysicalCardDragOrigin =
  | { type: "collection" }
  | { type: "deck"; sectionId: string; columnId: string };

/**
 * Dragged from a collection table row (one or more copies of a grouped row) or a
 * run of deck stack images (may span different card types).
 */
export interface PhysicalCardDragItem {
  kind: "physical";
  /** One or more physical card ids being moved together. */
  physicalCardIds: string[];
  /** The grabbed card — used for single-card previews and collection-row drags. */
  card: MtgCard;
  /** Full card data for every card in the dragged run, in order. Present when
   *  dragging from a deck column; absent for collection-row drags. */
  cards?: MtgCard[];
  /** Owning collection of the dragged copies, or null when ephemeral (deck-only). */
  sourceCollectionId: string | null;
  sourceDeckId?: string | null;
  /** True when the dragged card(s) are ephemeral: only same-deck reorder is allowed. */
  isEphemeral?: boolean;
  /** Human-readable source names for the drag-layer membership badges. */
  sourceCollectionName?: string;
  sourceDeckName?: string;
  origin: PhysicalCardDragOrigin;
}

export type AnyDragItem = NewCardDragItem | PhysicalCardDragItem;

/** True when the dragged item is an ephemeral (deck-only) physical card. */
export function isEphemeralItem(item: AnyDragItem | null | undefined): boolean {
  return !!item && item.kind === "physical" && !!item.isEphemeral;
}

/** A concrete drop destination handed to the dispatcher. */
export type DropTarget =
  | { kind: "collection"; collectionId: string }
  | { kind: "deck-column"; deckId: string; sectionId: string; columnId: string; index: number }
  | { kind: "deck-new-column"; deckId: string; sectionId: string }
  | { kind: "deck-new-section"; deckId: string }
  | { kind: "entity-button"; entity: OpenEntitySummary };

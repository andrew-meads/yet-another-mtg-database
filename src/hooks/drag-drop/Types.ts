import { MtgCard } from "@/types/MtgCard";
import { DetailedCardEntry } from "@/types/CardCollection";

export interface CollectionDragSourcePayload {
  /** The card being dropped (for CARD type) */
  card?: MtgCard;

  /** The source collection ID (for CARD_ENTRY type) */
  sourceCollectionId?: string;
  /** The card entry being dropped (for CARD_ENTRY type) */
  entry?: DetailedCardEntry;
  /** The source index of the card entry being dropped (for CARD_ENTRY type) */
  sourceIndex?: number;
  /** The quantity being moved (for CARD_ENTRY type). If undefined, assume the entire quantity is being moved. */
  quantity?: number;
  /** Whether the drag originated from the Deck View */
  draggingFromDeckView?: boolean;
}

/**
 * Payload passed to the onDrop callback
 */
export interface CollectionDropTargetPayload extends CollectionDragSourcePayload {
  /** The client coordinates where the drop occurred */
  dropPosition: { x: number; y: number };
  /** The index within the target collection where the drop occurred. -1 means no particular position, and the handler can assume anywhere they like. */
  dropIndex: number;
}

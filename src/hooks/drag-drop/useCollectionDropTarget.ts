import { useDrop } from "react-dnd";
import { useState } from "react";
import { MtgCard } from "@/types/MtgCard";
import { CollectionSummary, DetailedCardEntry } from "@/types/CardCollection";
import { useUpdateCardQuantities } from "@/hooks/react-query/useUpdateCardQuantities";

/**
 * Options for the collection drop target hook
 */
export interface UseCollectionDropTargetOptions {
  /** The collection to drop cards or card entries into */
  collection: CollectionSummary;
  /** Optional callback when a card or card entry is dropped */
  onDrop?: (payload: UseCollectionDropTargetDropPayload) => void;
  allowDrop: boolean;
}

/**
 * Return type for the collection drop target hook
 */
export interface UseCollectionDropTargetResult {
  /** Whether a card or card entry is currently being dragged over this target */
  isOver: boolean;
  /** The client coordinates where the cursor is currently hovering (null when not hovering) */
  hoverPosition: { x: number; y: number } | null;
  /** The payload currently being dragged over this target (null when not hovering) */
  hoverPayload: UseCollectionDropTargetDropPayload | null;
  /** Ref to attach to the drop target element */
  dropRef: React.Ref<HTMLDivElement>;
}

/**
 * Payload passed to the onDrop callback
 */
interface UseCollectionDropTargetDropPayload {
  /** The card being dropped (for CARD type) */
  card?: MtgCard;

  /** The source collection ID (for CARD_ENTRY type) */
  sourceCollectionId?: string;
  /** The card entry being dropped (for CARD_ENTRY type) */
  entry?: DetailedCardEntry;
  /** The source index of the card entry being dropped (for CARD_ENTRY type) */
  sourceIndex?: number;

  /** The client coordinates where the drop occurred */
  dropPosition: { x: number; y: number };
}

/**
 * Hook to make a collection component a drop target for cards and card entries
 *
 * Accepts two drag types:
 * - "CARD": Dragged cards from search results - adds one copy to the collection
 * - "CARD_ENTRY": Dragged cards from another collection - moves one copy from source to target
 *
 * When dropping a CARD_ENTRY from the same collection, no modification is made,
 * only the optional callback is invoked.
 *
 * @example
 * const { isOver, dropRef } = useCollectionDropTarget({
 *   collection: myCollection,
 *   onDrop: (payload) => console.log(`Dropped ${payload.card?.name || payload.entry?.card.name}`)
 * });
 *
 * return <div ref={dropRef}>...</div>;
 */
export function useCollectionDropTarget({
  collection,
  onDrop,
  allowDrop
}: UseCollectionDropTargetOptions): UseCollectionDropTargetResult {
  const { mutate: updateCardQuantities } = useUpdateCardQuantities();

  // Track hover position separately since collect doesn't run on every mouse move
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);

  const [{ isOver, hoverPayload }, dropRef] = useDrop<
    UseCollectionDropTargetDropPayload,
    void,
    {
      isOver: boolean;
      hoverPayload: UseCollectionDropTargetDropPayload | null;
    }
  >(
    () => ({
      accept: ["CARD", "CARD_ENTRY"],
      canDrop: () => allowDrop,
      collect: (monitor) => {
        const item = monitor.getItem<UseCollectionDropTargetDropPayload>();
        return {
          isOver: monitor.isOver(),
          hoverPayload: monitor.isOver() && item ? item : null
        };
      },
      hover: (_, monitor) => {
        // Update hover position on every mouse move
        const clientOffset = monitor.getClientOffset();
        if (monitor.isOver() && clientOffset) {
          setHoverPosition({ x: clientOffset.x, y: clientOffset.y });
        } else {
          setHoverPosition(null);
        }
      },
      drop: (payload, monitor) => {
        const { card, entry, sourceCollectionId } = payload;

        // Get drop position and shift key state
        const clientOffset = monitor.getClientOffset();
        const dropPosition = clientOffset
          ? { x: clientOffset.x, y: clientOffset.y }
          : { x: 0, y: 0 };

        // Create enhanced payload with drop metadata
        const enhancedPayload: UseCollectionDropTargetDropPayload = {
          ...payload,
          dropPosition
        };

        // If dropping a CARD_ENTRY from the same collection, ignore, just use callback.
        if (sourceCollectionId === collection._id) return onDrop?.(enhancedPayload);

        let cardToAdd = card;
        let amount = 1;

        // If dropping a CARD_ENTRY, extract the card and remove it from the source collection
        if (!cardToAdd && entry) {
          cardToAdd = entry.card;
          amount = entry.quantity;

          // Remove all copies of the card from the source collection.
          updateCardQuantities({
            collectionId: sourceCollectionId!,
            modifications: [
              {
                cardId: cardToAdd.id,
                operator: "subtract",
                amount
              }
            ]
          });
        }

        // Add that many copies of the card to the target collection.
        updateCardQuantities({
          collectionId: collection._id,
          modifications: [
            {
              cardId: cardToAdd!.id,
              operator: "add",
              amount
            }
          ]
        });

        // Call custom callback if provided
        onDrop?.(enhancedPayload);
      }
    }),
    [collection._id, onDrop, updateCardQuantities, allowDrop]
  );

  return {
    isOver,
    hoverPosition,
    hoverPayload,
    dropRef: dropRef as unknown as React.Ref<HTMLDivElement>
  };
}

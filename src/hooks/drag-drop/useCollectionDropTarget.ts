import { DropTargetMonitor, useDrop } from "react-dnd";
import { useState } from "react";
import { CollectionSummary } from "@/types/CardCollection";
import { CollectionDropTargetPayload } from "./Types";
import { useUpdateCollectionCards } from "../react-query/useUpdateCollectionCards";
import { MtgCard } from "@/types/MtgCard";

/**
 * Options for the collection drop target hook
 */
export interface UseCollectionDropTargetOptions {
  /** The collection to drop cards or card entries into */
  collection: CollectionSummary;
  /** Optional callback when a card or card entry is dropped. */
  onDrop?: (payload: CollectionDropTargetPayload) => boolean | void;
  /** Whether dropping is allowed on this target */
  allowDrop:
    | boolean
    | ((
        item: CollectionDropTargetPayload,
        monitor: DropTargetMonitor<CollectionDropTargetPayload, void>
      ) => boolean);
  /** Optional callback when a card or card entry is dropped, which should calculate the index where the drop occurred. */
  getDestinationIndex?: (hoverPosition: { x: number; y: number }) => number;
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
  hoverPayload: CollectionDropTargetPayload | null;
  /** Ref to attach to the drop target element */
  dropRef: React.Ref<HTMLDivElement>;
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
  allowDrop,
  getDestinationIndex
}: UseCollectionDropTargetOptions): UseCollectionDropTargetResult {
  const { mutate: updateCardsInCollection } = useUpdateCollectionCards();

  // Track hover position separately since collect doesn't run on every mouse move
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);

  const [{ isOver, hoverPayload }, dropRef] = useDrop<
    CollectionDropTargetPayload,
    void,
    {
      isOver: boolean;
      hoverPayload: CollectionDropTargetPayload | null;
    }
  >({
    accept: ["CARD", "CARD_ENTRY"],
    canDrop: typeof allowDrop === "function" ? allowDrop : () => allowDrop,
    collect: (monitor) => {
      const item = monitor.getItem<CollectionDropTargetPayload>();
      return {
        isOver: monitor.isOver() && monitor.canDrop(),
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
      // Get drop position
      const clientOffset = monitor.getClientOffset();
      const dropPosition = clientOffset ? { x: clientOffset.x, y: clientOffset.y } : { x: 0, y: 0 };

      // Calculate drop index if callback provided
      const dropIndex = getDestinationIndex ? getDestinationIndex(dropPosition) : -1;

      // Create enhanced payload with drop metadata
      const enhancedPayload: CollectionDropTargetPayload = {
        ...payload,
        dropPosition,
        dropIndex
      };

      // If custom onDrop handler provided, call it
      const result = onDrop?.(enhancedPayload);

      // Default behaviour: add/move card(s) between collections
      if (!onDrop || result)
        return defaultDropBehaviour(collection, updateCardsInCollection, enhancedPayload);
    }
  });

  return {
    isOver,
    hoverPosition,
    hoverPayload,
    dropRef: dropRef as unknown as React.Ref<HTMLDivElement>
  };
}

function defaultDropBehaviour(
  targetCollection: CollectionSummary,
  updateCardsInCollection: (arg: any) => void,
  { card, entry, sourceCollectionId, sourceIndex, dropIndex, quantity }: CollectionDropTargetPayload
) {
  // If we're just dropping a CARD, do that now and return.
  if (card) return dropCard(targetCollection, card, 1, updateCardsInCollection);

  const isSameCollection = sourceCollectionId === targetCollection._id;

  // If dropping to the same collection, move the card to a new index
  if (isSameCollection) {
    // console.log("Source index:", sourceIndex, "Drop index:", dropIndex);
    return updateCardsInCollection({
      collectionId: targetCollection._id,
      action: "move",
      fromIndex: sourceIndex!,
      toIndex: dropIndex,
      quantity
    });
  }

  // Otherwise, remove from the source collection and add to the target collection
  // Remove quantity copies of the card from the source collection.
  updateCardsInCollection({
    collectionId: sourceCollectionId!,
    action: "remove",
    fromIndex: sourceIndex!,
    quantity
  });

  // Add that many copies of the card to the target collection.
  updateCardsInCollection({
    collectionId: targetCollection._id,
    action: "add",
    entry: {
      cardId: entry!.card.id,
      quantity: entry!.quantity,
      notes: entry!.notes,
      tags: entry!.tags || []
    },
    quantity
  });
}

function dropCard(
  collection: CollectionSummary,
  card: MtgCard,
  quantity: number,
  updateCardsInCollection: (arg: any) => void
) {
  // Add that many copies of the card to the target collection.
  updateCardsInCollection({
    collectionId: collection._id,
    action: "add",
    entry: {
      cardId: card.id,
      quantity
    }
  });
}

import { useDrop } from "react-dnd";
import { MtgCard } from "@/types/MtgCard";
import { CollectionSummary } from "@/types/CardCollection";
import { useUpdateCardQuantities } from "@/hooks/useUpdateCardQuantities";

/**
 * Options for the collection drop target hook
 */
export interface UseCollectionDropTargetOptions {
  /** The collection to drop cards into */
  collection: CollectionSummary;
  /** Optional callback when a card is dropped */
  onDrop?: (card: MtgCard) => void;
}

/**
 * Return type for the collection drop target hook
 */
export interface UseCollectionDropTargetResult {
  /** Whether a card is currently being dragged over this target */
  isOver: boolean;
  /** Ref to attach to the drop target element */
  dropRef: React.Ref<HTMLDivElement>;
}

/**
 * Hook to make a collection button a drop target for cards
 *
 * Accepts dragged cards of type "CARD" and automatically adds one copy
 * of the dropped card to the target collection using the API.
 *
 * @example
 * const { isOver, dropRef } = useCollectionDropTarget({
 *   collection: myCollection,
 *   onDrop: (card) => console.log(`Dropped ${card.name}`)
 * });
 *
 * return <div ref={dropRef}>...</div>;
 */
export function useCollectionDropTarget({
  collection,
  onDrop
}: UseCollectionDropTargetOptions): UseCollectionDropTargetResult {
  const { mutate: updateCardQuantities } = useUpdateCardQuantities();

  const [{ isOver }, dropRef] = useDrop(
    () => ({
      accept: "CARD",
      collect: (monitor) => ({
        isOver: monitor.isOver()
      }),
      drop: ({ card }: { card: MtgCard }) => {
        // Add one copy of the card to the collection
        updateCardQuantities({
          collectionId: collection._id,
          modifications: [
            {
              cardId: card.id,
              operator: "add",
              amount: 1
            }
          ]
        });

        // Call custom callback if provided
        if (onDrop) {
          onDrop(card);
        }
      }
    }),
    [collection._id, onDrop, updateCardQuantities]
  );

  return {
    isOver,
    dropRef: dropRef as unknown as React.Ref<HTMLDivElement>
  };
}

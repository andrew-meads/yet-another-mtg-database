import { useEffect } from "react";
import { useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { MtgCard } from "@/types/MtgCard";
import { PHYSICAL_CARD, PhysicalCardDragItem, PhysicalCardDragOrigin } from "./Types";

interface UsePhysicalCardDragSourceProps {
  physicalCardIds: string[];
  card: MtgCard;
  /** Full card data for every card in the dragged run (deck-column drags only). */
  cards?: MtgCard[];
  sourceCollectionId: string;
  sourceDeckId?: string | null;
  /** Human-readable source names for the drag-layer membership badges. */
  sourceCollectionName?: string;
  sourceDeckName?: string;
  origin: PhysicalCardDragOrigin;
  canDrag?: boolean;
  hideDefaultPreview?: boolean;
  /** Optional dynamic item builder (e.g. a collection row choosing how many copies). */
  getItem?: () => PhysicalCardDragItem;
}

/**
 * Makes a component a drag source for one or more existing physical cards.
 */
export function usePhysicalCardDragSource({
  physicalCardIds,
  card,
  cards,
  sourceCollectionId,
  sourceDeckId,
  sourceCollectionName,
  sourceDeckName,
  origin,
  canDrag = true,
  hideDefaultPreview = true,
  getItem
}: UsePhysicalCardDragSourceProps) {
  const [{ isDragging, draggedItem }, dragRef, preview] = useDrag(
    () => ({
      type: PHYSICAL_CARD,
      item:
        getItem ??
        ((): PhysicalCardDragItem => ({
          kind: "physical",
          physicalCardIds,
          card,
          cards,
          sourceCollectionId,
          sourceDeckId,
          sourceCollectionName,
          sourceDeckName,
          origin
        })),
      canDrag,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
        draggedItem: monitor.getItem() as PhysicalCardDragItem
      })
    }),
    [
      physicalCardIds,
      card,
      cards,
      sourceCollectionId,
      sourceDeckId,
      sourceCollectionName,
      sourceDeckName,
      origin,
      canDrag
    ]
  );

  useEffect(() => {
    if (hideDefaultPreview) preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview, hideDefaultPreview]);

  return { isDragging, dragRef, draggedItem };
}

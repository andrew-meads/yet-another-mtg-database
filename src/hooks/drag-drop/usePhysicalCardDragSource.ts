import { useEffect } from "react";
import { useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { MtgCard } from "@/types/MtgCard";
import { PHYSICAL_CARD, PhysicalCardDragItem, PhysicalCardDragOrigin } from "./Types";

interface UsePhysicalCardDragSourceProps {
  /** The physical card id(s) being dragged. A deck stack image passes one; a
   *  grouped collection row may pass several (all of the same card/coll/deck). */
  physicalCardIds: string[];
  card: MtgCard;
  sourceCollectionId: string;
  sourceDeckId?: string | null;
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
  sourceCollectionId,
  sourceDeckId,
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
          sourceCollectionId,
          sourceDeckId,
          origin
        })),
      canDrag,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
        draggedItem: monitor.getItem() as PhysicalCardDragItem
      })
    }),
    [physicalCardIds, card, sourceCollectionId, sourceDeckId, origin, canDrag]
  );

  useEffect(() => {
    if (hideDefaultPreview) preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview, hideDefaultPreview]);

  return { isDragging, dragRef, draggedItem };
}

import { useEffect } from "react";
import { useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { DetailedCardEntry } from "@/types/CardCollection";

/**
 * Custom hook to make a component a drag source for entries in a collection
 *
 * Captures the shift key state during dragging for use in drop handlers.
 *
 * @param sourceCollectionId - The ID of the collection this entry belongs to
 * @param entry - The DetailedCardEntry being dragged
 * @param canDrag - Optional: Whether dragging is enabled (default: true)
 * @param hideDefaultPreview - Optional: Whether to hide the default drag preview (default: false)
 * @returns Object containing isDragging state and dragRef to attach to the draggable element
 */
export function useCardEntryDragSource(
  sourceCollectionId: string,
  entry: DetailedCardEntry,
  canDrag: boolean = true,
  hideDefaultPreview: boolean = false
) {
  const [{ isDragging }, dragRef, preview] = useDrag(
    () => ({
      type: "CARD_ENTRY",
      item: () => ({ sourceCollectionId, entry }),
      canDrag,
      collect: (monitor) => ({
        isDragging: monitor.isDragging()
      })
    }),
    [entry, canDrag, sourceCollectionId]
  );

  // Hide the default browser drag preview
  useEffect(() => {
    if (hideDefaultPreview) preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview, hideDefaultPreview]);

  return { isDragging, dragRef };
}

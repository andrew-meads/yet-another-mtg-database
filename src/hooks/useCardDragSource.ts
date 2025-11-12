import { useEffect } from "react";
import { useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { MtgCard } from "@/types/MtgCard";

/**
 * Custom hook to make a component a drag source for MTG cards
 * 
 * @param card - The MTG card to be dragged
 * @param canDrag - Optional: Whether dragging is enabled (default: true)
 * @returns Object containing isDragging state and dragRef to attach to the draggable element
 */
export function useCardDragSource(card: MtgCard, canDrag: boolean = true) {
  const [{ isDragging }, dragRef, preview] = useDrag(
    () => ({
      type: "CARD",
      item: { card },
      canDrag,
      collect: (monitor) => ({
        isDragging: monitor.isDragging()
      })
    }),
    [card, canDrag]
  );

  // Hide the default browser drag preview
  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return { isDragging, dragRef };
}

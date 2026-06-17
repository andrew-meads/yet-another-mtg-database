import { useEffect } from "react";
import { useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { MtgCard } from "@/types/MtgCard";
import { NEW_CARD, NewCardDragItem } from "./Types";

/**
 * Makes a component a drag source for a brand-new card (from search results).
 */
export function useNewCardDragSource(card: MtgCard, canDrag: boolean = true) {
  const [{ isDragging }, dragRef, preview] = useDrag(
    () => ({
      type: NEW_CARD,
      item: (): NewCardDragItem => ({ kind: "new", card }),
      canDrag,
      collect: (monitor) => ({ isDragging: monitor.isDragging() })
    }),
    [card, canDrag]
  );

  // Hide the default browser drag preview (we render a custom drag layer)
  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return { isDragging, dragRef };
}

import { useEffect } from "react";
import { useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { SlimMtgCard } from "@/types/MtgCard";
import { NewCopyMeta } from "@/types/PhysicalCard";
import { NEW_CARD, NewCardDragItem } from "./Types";

/**
 * Makes a component a drag source for a brand-new card (from search results).
 * `meta` (notes/tags/finish/condition) rides along on the drag item so the drop
 * dispatcher can create the copy with those fields.
 */
export function useNewCardDragSource(
  card: SlimMtgCard,
  canDrag: boolean = true,
  meta?: NewCopyMeta
) {
  const notes = meta?.notes;
  const tags = meta?.tags;
  const finish = meta?.finish;
  const condition = meta?.condition;

  const [{ isDragging }, dragRef, preview] = useDrag(
    () => ({
      type: NEW_CARD,
      item: (): NewCardDragItem => ({ kind: "new", card, notes, tags, finish, condition }),
      canDrag,
      collect: (monitor) => ({ isDragging: monitor.isDragging() })
    }),
    [card, canDrag, notes, tags, finish, condition]
  );

  // Hide the default browser drag preview (we render a custom drag layer)
  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return { isDragging, dragRef };
}

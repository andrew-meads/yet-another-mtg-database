import { useDrop } from "react-dnd";
import React from "react";
import { AnyDragItem, isEphemeralItem, NEW_CARD, PHYSICAL_CARD, PhysicalCardDragItem } from "./Types";
import { useDropDispatch } from "./useDropDispatch";

type RefResult = React.Ref<HTMLDivElement>;

/** Ephemeral cards may only be dropped back onto their own deck. */
function deckCanDrop(item: AnyDragItem, deckId: string): boolean {
  if (!isEphemeralItem(item)) return true;
  return (item as PhysicalCardDragItem).sourceDeckId === deckId;
}

/**
 * Drop target for a single deck column. `computeIndex` maps the pointer offset to
 * an insert position within the column (based on the overlapping card stack).
 */
export function useDeckColumnDropTarget(params: {
  deckId: string;
  sectionId: string;
  columnId: string;
  computeIndex?: (offset: { x: number; y: number } | null) => number;
}) {
  const dispatch = useDropDispatch();
  const [{ isOver }, dropRef] = useDrop<AnyDragItem, void, { isOver: boolean }>({
    accept: [NEW_CARD, PHYSICAL_CARD],
    canDrop: (item) => deckCanDrop(item, params.deckId),
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      const index = params.computeIndex ? params.computeIndex(monitor.getClientOffset()) : 0;
      void dispatch(item, {
        kind: "deck-column",
        deckId: params.deckId,
        sectionId: params.sectionId,
        columnId: params.columnId,
        index
      });
    },
    collect: (monitor) => ({ isOver: monitor.isOver({ shallow: true }) && monitor.canDrop() })
  });
  return { isOver, dropRef: dropRef as unknown as RefResult };
}

/** Drop target that creates a new column in a section and drops the card there. */
export function useDeckNewColumnDropTarget(deckId: string, sectionId: string) {
  const dispatch = useDropDispatch();
  const [{ isOver }, dropRef] = useDrop<AnyDragItem, void, { isOver: boolean }>({
    accept: [NEW_CARD, PHYSICAL_CARD],
    canDrop: (item) => deckCanDrop(item, deckId),
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      void dispatch(item, { kind: "deck-new-column", deckId, sectionId });
    },
    collect: (monitor) => ({ isOver: monitor.isOver({ shallow: true }) && monitor.canDrop() })
  });
  return { isOver, dropRef: dropRef as unknown as RefResult };
}

/** Drop target that creates a new section and drops the card into it. */
export function useDeckNewSectionDropTarget(deckId: string) {
  const dispatch = useDropDispatch();
  const [{ isOver }, dropRef] = useDrop<AnyDragItem, void, { isOver: boolean }>({
    accept: [NEW_CARD, PHYSICAL_CARD],
    canDrop: (item) => deckCanDrop(item, deckId),
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      void dispatch(item, { kind: "deck-new-section", deckId });
    },
    collect: (monitor) => ({ isOver: monitor.isOver({ shallow: true }) && monitor.canDrop() })
  });
  return { isOver, dropRef: dropRef as unknown as RefResult };
}

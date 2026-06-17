import { useDrop } from "react-dnd";
import React from "react";
import { AnyDragItem, NEW_CARD, PHYSICAL_CARD } from "./Types";
import { OpenEntitySummary } from "@/types/Deck";
import { useDropDispatch } from "./useDropDispatch";

/**
 * Drop target for an open-entity button/tab. Dropping a card onto a collection
 * adds/moves it there; onto a deck appends it to the deck's default column.
 */
export function useEntityButtonDropTarget(entity: OpenEntitySummary) {
  const dispatch = useDropDispatch();
  const [{ isOver }, dropRef] = useDrop<AnyDragItem, void, { isOver: boolean }>({
    accept: [NEW_CARD, PHYSICAL_CARD],
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      void dispatch(item, { kind: "entity-button", entity });
    },
    collect: (monitor) => ({ isOver: monitor.isOver() && monitor.canDrop() })
  });
  return { isOver, dropRef: dropRef as unknown as React.Ref<HTMLDivElement> };
}

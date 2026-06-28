import { useDrop } from "react-dnd";
import React from "react";
import { AnyDragItem, isEphemeralItem, NEW_CARD, PHYSICAL_CARD, PhysicalCardDragItem } from "./Types";
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
    // Ephemeral cards may only return to their own deck — never a collection or
    // a different deck button.
    canDrop: (item) =>
      !isEphemeralItem(item) ||
      (entity.kind === "deck" && entity._id === (item as PhysicalCardDragItem).sourceDeckId),
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      void dispatch(item, { kind: "entity-button", entity });
    },
    collect: (monitor) => ({ isOver: monitor.isOver() && monitor.canDrop() })
  });
  return { isOver, dropRef: dropRef as unknown as React.Ref<HTMLDivElement> };
}

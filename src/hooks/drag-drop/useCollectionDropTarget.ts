import { useDrop } from "react-dnd";
import React from "react";
import { AnyDragItem, isEphemeralItem, NEW_CARD, PHYSICAL_CARD } from "./Types";
import { useDropDispatch } from "./useDropDispatch";

/**
 * Makes a component a drop target for a collection. Collections are sorted (not
 * hand-ordered), so there is no insert index — a drop simply adds/moves the
 * card(s) into this collection.
 */
export function useCollectionDropTarget(collectionId: string, allowDrop: boolean = true) {
  const dispatch = useDropDispatch();

  const [{ isOver, canDrop }, dropRef] = useDrop<
    AnyDragItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >({
    accept: [NEW_CARD, PHYSICAL_CARD],
    // Ephemeral cards can never enter a collection.
    canDrop: (item) => allowDrop && !isEphemeralItem(item),
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      void dispatch(item, { kind: "collection", collectionId });
    },
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }) && monitor.canDrop(),
      canDrop: monitor.canDrop()
    })
  });

  return { isOver, canDrop, dropRef: dropRef as unknown as React.Ref<HTMLDivElement> };
}

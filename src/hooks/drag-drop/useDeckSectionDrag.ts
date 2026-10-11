import React, { useCallback, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { moveSectionInOrder, SectionDropPosition } from "@/lib/deckUtils";
import { DECK_SECTION, DeckSectionDragItem } from "./Types";

/**
 * Makes a deck section draggable. Connect `dragRef` to the grip handle and
 * `previewRef` to whatever the browser should render as the drag image (the header).
 */
export function useDeckSectionDragSource(deckId: string, sectionId: string) {
  const [{ isDragging }, dragRef, previewRef] = useDrag(
    () => ({
      type: DECK_SECTION,
      item: (): DeckSectionDragItem => ({ kind: "section", deckId, sectionId }),
      collect: (monitor) => ({ isDragging: monitor.isDragging() })
    }),
    [deckId, sectionId]
  );
  return {
    isDragging,
    dragRef: dragRef as unknown as React.Ref<HTMLButtonElement>,
    previewRef: previewRef as unknown as React.Ref<HTMLDivElement>
  };
}

/**
 * Makes a whole deck section a drop target for another section of the same deck.
 * The pointer's half of the section decides whether the dragged one lands before or
 * after it; `dropPosition` is null when not hovered or when the drop is a no-op.
 */
export function useDeckSectionDropTarget(params: {
  deckId: string;
  sectionId: string;
  /** Every section id of the deck, in current order. */
  sectionIds: string[];
  onReorder: (order: string[]) => void;
}) {
  const { deckId, sectionId, sectionIds, onReorder } = params;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [hoverPosition, setHoverPosition] = useState<SectionDropPosition | null>(null);

  const positionFor = (y: number | undefined): SectionDropPosition | null => {
    const rect = elementRef.current?.getBoundingClientRect();
    if (!rect || y === undefined) return null;
    return y < rect.top + rect.height / 2 ? "before" : "after";
  };

  const [{ isOver }, dropRef] = useDrop<DeckSectionDragItem, void, { isOver: boolean }>(
    () => ({
      accept: DECK_SECTION,
      canDrop: (item) => item.deckId === deckId,
      hover: (item, monitor) => {
        const position = positionFor(monitor.getClientOffset()?.y);
        const moves =
          position && moveSectionInOrder(sectionIds, item.sectionId, sectionId, position);
        setHoverPosition(moves ? position : null);
      },
      drop: (item, monitor) => {
        const position = positionFor(monitor.getClientOffset()?.y);
        const order =
          position && moveSectionInOrder(sectionIds, item.sectionId, sectionId, position);
        if (order) onReorder(order);
      },
      collect: (monitor) => ({ isOver: monitor.isOver() && monitor.canDrop() })
    }),
    [deckId, sectionId, sectionIds, onReorder]
  );

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      elementRef.current = node;
      dropRef(node);
    },
    [dropRef]
  );

  return { dropRef: ref, dropPosition: isOver ? hoverPosition : null };
}

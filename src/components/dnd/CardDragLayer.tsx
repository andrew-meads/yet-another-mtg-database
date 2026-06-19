"use client";

import { useDragLayer } from "react-dnd";
import CardArtView from "@/components/CardArtView";
import { AnyDragItem, NEW_CARD } from "@/hooks/drag-drop/Types";

/** Drag preview for a brand-new card dragged from search results. */
export default function CardDragLayer() {
  const { item, currentOffset, itemType } = useDragLayer((monitor) => ({
    item: monitor.getItem() as AnyDragItem | null,
    itemType: monitor.getItemType(),
    currentOffset: monitor.getClientOffset()
  }));

  if (!item || item.kind !== "new" || !currentOffset || itemType !== NEW_CARD) return null;

  const cardWidth = 146 / 2;
  const cardHeight = 204 / 2;
  const transform = `translate(${currentOffset.x - cardWidth}px, ${currentOffset.y - cardHeight}px)`;

  return (
    <div
      style={{
        position: "fixed",
        pointerEvents: "none",
        zIndex: 100,
        left: 0,
        top: 0,
        transform,
        height: "204px",
        opacity: 0.9
      }}
    >
      <CardArtView card={item.card} variant="small" />
    </div>
  );
}

"use client";

import { useDragLayer } from "react-dnd";
import CardArtView from "@/components/CardArtView";
import { CollectionDragSourcePayload } from "@/hooks/drag-drop/Types";

export default function CardDragLayer() {
  const { item, currentOffset, itemType } = useDragLayer((monitor) => ({
    item: monitor.getItem() as CollectionDragSourcePayload,
    itemType: monitor.getItemType(),
    currentOffset: monitor.getClientOffset()
  }));

  if (!item || !currentOffset || itemType !== "CARD") return null;

  // Offset by half the card dimensions to center it on the cursor
  // Adjust these values based on your "small" variant dimensions
  const cardWidth = 146 / 2; // half of small variant width
  const cardHeight = 204 / 2; // half of small variant height

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
        height: "204px"
      }}
    >
      <CardArtView card={item.card!} variant="small" />
    </div>
  );
}

"use client";

import { useDragLayer } from "react-dnd";
import { SimpleCardArtView } from "@/components/CardArtView";
import { CollectionDragSourcePayload } from "@/hooks/drag-drop/Types";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  OVERLAP_OFFSET
} from "@/components/my-cards-page/deck-view/card-dimensions";

export default function DeckColumnDragLayer() {
  const { item, currentOffset, itemType } = useDragLayer((monitor) => ({
    item: monitor.getItem() as CollectionDragSourcePayload,
    itemType: monitor.getItemType(),
    currentOffset: monitor.getClientOffset()
  }));

  if (!item || !currentOffset || itemType !== "CARD_ENTRY" || !item?.draggingFromDeckView)
    return null;

  // How many cards are being dragged
  const quantity = item.quantity ?? 1;
  const entry = item.entry!;
  const quantityArray = Array.from({ length: quantity }, (_, i) => i + 1);

  // Offset by half the card dimensions to center it on the cursor
  const transform = `translate(${currentOffset.x - CARD_WIDTH / 2}px, ${currentOffset.y - CARD_HEIGHT / 2}px)`;

  return (
    <div
      style={{
        position: "fixed",
        pointerEvents: "none",
        zIndex: 100,
        left: 0,
        top: 0,
        transform,
        width: `${CARD_WIDTH}px`,
        opacity: 0.9
      }}
    >
      <div className="flex flex-col w-min">
        {quantityArray.map((_, i) => (
          <div
            key={i}
            className="shrink-0"
            style={{
              width: `${CARD_WIDTH}px`,
              height: `${CARD_HEIGHT}px`,
              marginTop: i > 0 ? `-${CARD_HEIGHT - OVERLAP_OFFSET}px` : undefined
            }}
          >
            <SimpleCardArtView
              card={entry.card}
              variant="small"
              width={CARD_WIDTH}
              height={CARD_HEIGHT}
            />
          </div>
        ))}
      </div>

      <div className="absolute top-0 left-0 right-0 bottom-0 flex items-start justify-end p-4 text-3xl font-bold text-white">
        <span className="bg-[rgba(0,0,0,0.6)] w-12 h-12 flex items-center justify-center rounded-full">
          {quantity}x
        </span>
      </div>
    </div>
  );
}

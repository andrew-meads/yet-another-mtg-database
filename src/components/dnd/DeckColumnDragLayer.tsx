"use client";

import { useDragLayer } from "react-dnd";
import { SimpleCardArtView } from "@/components/CardArtView";
import { AnyDragItem, PHYSICAL_CARD } from "@/hooks/drag-drop/Types";
import { CARD_WIDTH, CARD_HEIGHT } from "@/components/my-cards-page/deck-view/card-dimensions";

/** Drag preview for one (or several) existing physical cards. */
export default function DeckColumnDragLayer() {
  const { item, currentOffset, itemType } = useDragLayer((monitor) => ({
    item: monitor.getItem() as AnyDragItem | null,
    itemType: monitor.getItemType(),
    currentOffset: monitor.getClientOffset()
  }));

  if (!item || item.kind !== "physical" || !currentOffset || itemType !== PHYSICAL_CARD) return null;

  const count = item.physicalCardIds.length;
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
      <SimpleCardArtView card={item.card} variant="small" width={CARD_WIDTH} height={CARD_HEIGHT} />
      {count > 1 && (
        <div className="absolute top-0 right-0 p-2 text-2xl font-bold">
          <span className="bg-background/70 w-10 h-10 flex items-center justify-center rounded-full">
            {count}x
          </span>
        </div>
      )}
    </div>
  );
}

"use client";

import { useDragLayer } from "react-dnd";
import { SimpleCardArtView } from "@/components/CardArtView";
import { AnyDragItem, PHYSICAL_CARD } from "@/hooks/drag-drop/Types";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  OVERLAP_OFFSET
} from "@/components/my-cards-page/deck-view/card-dimensions";

const MAX_VISIBLE = 6;

/** Drag preview for one or more existing physical cards from a deck column. */
export default function DeckColumnDragLayer() {
  const { item, currentOffset, itemType } = useDragLayer((monitor) => ({
    item: monitor.getItem() as AnyDragItem | null,
    itemType: monitor.getItemType(),
    currentOffset: monitor.getClientOffset()
  }));

  if (!item || item.kind !== "physical" || !currentOffset || itemType !== PHYSICAL_CARD) return null;

  const allCards = item.cards ?? [item.card];
  const visible = allCards.slice(0, MAX_VISIBLE);
  const totalHeight = CARD_HEIGHT + (visible.length - 1) * OVERLAP_OFFSET;
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
        height: `${totalHeight}px`,
        opacity: 0.9
      }}
    >
      {visible.map((c, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: i * OVERLAP_OFFSET,
            width: CARD_WIDTH,
            height: CARD_HEIGHT
          }}
        >
          <SimpleCardArtView card={c} variant="small" width={CARD_WIDTH} height={CARD_HEIGHT} />
        </div>
      ))}
    </div>
  );
}

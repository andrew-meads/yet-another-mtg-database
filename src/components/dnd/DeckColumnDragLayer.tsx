"use client";

import { useDragLayer } from "react-dnd";
import { Library, Layers, Sparkles } from "lucide-react";
import { SimpleCardArtView } from "@/components/CardArtView";
import { AnyDragItem, PHYSICAL_CARD } from "@/hooks/drag-drop/Types";
import { MtgCard } from "@/types/MtgCard";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  OVERLAP_OFFSET
} from "@/components/my-cards-page/deck-view/card-dimensions";

const MAX_VISIBLE = 6;

/**
 * Drag preview for one or more existing physical cards. Renders an overlapping
 * stack with a ×N count badge plus the source collection / deck membership badges.
 * Collection-row drags repeat the single card; deck-run drags show each distinct
 * card from `item.cards`.
 */
export default function DeckColumnDragLayer() {
  const { item, currentOffset, itemType } = useDragLayer((monitor) => ({
    item: monitor.getItem() as AnyDragItem | null,
    itemType: monitor.getItemType(),
    currentOffset: monitor.getClientOffset()
  }));

  if (!item || item.kind !== "physical" || !currentOffset || itemType !== PHYSICAL_CARD)
    return null;

  const isCollection = item.origin.type === "collection";
  const count = item.physicalCardIds.length;

  const stackCards: MtgCard[] = isCollection
    ? Array.from({ length: Math.min(count, MAX_VISIBLE) }, () => item.card)
    : (item.cards ?? [item.card]).slice(0, MAX_VISIBLE);

  const totalHeight = CARD_HEIGHT + (stackCards.length - 1) * OVERLAP_OFFSET;
  const transform = `translate(${currentOffset.x - CARD_WIDTH / 2}px, ${currentOffset.y - CARD_HEIGHT / 2}px)`;

  const hasBadges = item.sourceCollectionName || item.sourceDeckName || item.isEphemeral;

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
      {stackCards.map((c, i) => (
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

      {/* Count badge */}
      {count > 1 && (
        <div
          className="bg-primary text-primary-foreground absolute rounded-full px-2 py-0.5 text-xs font-semibold shadow"
          style={{ top: -8, right: -8 }}
        >
          ×{count}
        </div>
      )}

      {/* Membership badges */}
      {hasBadges && (
        <div className="absolute top-1 left-1 flex flex-col gap-1">
          {item.isEphemeral && (
            <span className="inline-flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
              <Sparkles className="size-3 shrink-0" />
              <span className="truncate">Ephemeral</span>
            </span>
          )}
          {item.sourceCollectionName && (
            <span className="inline-flex max-w-[130px] items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
              <Library className="size-3 shrink-0" />
              <span className="truncate">{item.sourceCollectionName}</span>
            </span>
          )}
          {item.sourceDeckName && (
            <span className="inline-flex max-w-[130px] items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
              <Layers className="size-3 shrink-0" />
              <span className="truncate">{item.sourceDeckName}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

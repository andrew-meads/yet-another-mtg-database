"use client";

import { SimpleCardArtView } from "@/components/CardArtView";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { MtgCard } from "@/types/MtgCard";
import { DeckColumn as DeckColumnData } from "@/types/Deck";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useCardSelection } from "@/context/CardSelectionContext";
import { CARD_WIDTH, CARD_HEIGHT, OVERLAP_OFFSET, CONTAINER_OFFSET } from "./card-dimensions";
import { usePhysicalCardDragSource } from "@/hooks/drag-drop/usePhysicalCardDragSource";
import { useDeckColumnDropTarget } from "@/hooks/drag-drop/useDeckDropTargets";
import { useDragLayer } from "react-dnd";
import { useDeckCardOp } from "@/hooks/react-query/useDeckCardOp";
import { useDeletePhysicalCard } from "@/hooks/react-query/useDeletePhysicalCard";
import { useDeleteColumn } from "@/hooks/react-query/useDeckColumns";
import { StickyNote, Tag, Library, Trash2, Layers } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from "@/components/ui/context-menu";

interface DeckColumnProps {
  deckId: string;
  deckName?: string;
  sectionId: string;
  column: DeckColumnData;
}

/** A single physical-card image within a column's overlapping stack. */
function DeckCardImage({
  deckId,
  deckName,
  sectionId,
  columnId,
  card,
  physicalCardIds,
  cards,
  isFirst,
  cardIndex,
  isBeingDragged,
  onDragIndexChange
}: {
  deckId: string;
  deckName?: string;
  sectionId: string;
  columnId: string;
  card: DetailedPhysicalCard;
  /** The physical card ids to drag together: this card plus every card on top of it. */
  physicalCardIds: string[];
  /** Full card data for every card in the run (for the drag preview). */
  cards: MtgCard[];
  isFirst: boolean;
  cardIndex: number;
  isBeingDragged: boolean;
  onDragIndexChange: (index: number | null) => void;
}) {
  const { setSelectedCard } = useCardSelection();
  const deckCardOp = useDeckCardOp();
  const deleteCard = useDeletePhysicalCard();

  const { isDragging, dragRef } = usePhysicalCardDragSource({
    physicalCardIds,
    card: card.card,
    cards,
    sourceCollectionId: card.collectionId,
    sourceDeckId: deckId,
    sourceCollectionName: card.collectionName,
    sourceDeckName: deckName,
    origin: { type: "deck", sectionId, columnId }
  });

  useEffect(() => {
    onDragIndexChange(isDragging ? cardIndex : null);
  }, [isDragging]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dragRef as unknown as React.Ref<HTMLDivElement>}
          data-testid={`deck-card-${card._id}`}
          className={cn(
            "shrink-0 relative select-none cursor-grab active:cursor-grabbing transition-all duration-200",
            isBeingDragged ? "grayscale blur-[1px]" : "hover:brightness-125"
          )}
          style={{
            width: `${CARD_WIDTH}px`,
            height: `${CARD_HEIGHT}px`,
            marginTop: isFirst ? undefined : `-${CARD_HEIGHT - OVERLAP_OFFSET}px`
          }}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedCard(card.card);
          }}
        >
          <SimpleCardArtView
            card={card.card}
            variant="normal"
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
          />

          {/* Collection badge (which collection this physical card belongs to) */}
          {card.collectionName && (
            <div className="absolute top-1 left-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="bg-black/70 rounded px-1 py-0.5 flex items-center gap-1 max-w-[120px]">
                    <Library className="h-3 w-3 text-white shrink-0" />
                    {/* <span className="text-[10px] text-white truncate">{card.collectionName}</span> */}
                  </div>
                </TooltipTrigger>
                <TooltipContent>In collection: {card.collectionName}</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Notes/tags */}
          {(card.notes || (card.tags && card.tags.length > 0)) && (
            <div className="absolute bottom-1 left-1 flex items-center gap-1">
              {card.notes && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-black/70 rounded p-1">
                      <StickyNote className="h-3 w-3 text-white" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs text-xs">{card.notes}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {card.tags && card.tags.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="bg-black/70 rounded p-1">
                      <Tag className="h-3 w-3 text-white" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs text-xs">{card.tags.join(", ")}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() =>
            deckCardOp.mutate({ deckId, op: "remove", physicalCardId: card._id })
          }
        >
          <Layers className="mr-2 h-4 w-4" />
          Remove from deck
        </ContextMenuItem>
        <ContextMenuItem onClick={() => deleteCard.mutate(card._id)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete card
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function DeckColumn({ deckId, deckName, sectionId, column }: DeckColumnProps) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const deleteColumn = useDeleteColumn();
  const [dragOriginIndex, setDragOriginIndex] = useState<number | null>(null);

  const computeIndex = (offset: { x: number; y: number } | null) => {
    const el = columnRef.current;
    if (!el || !offset) return column.cards.length;
    const rect = el.getBoundingClientRect();
    const relativeY = offset.y - rect.top - CONTAINER_OFFSET;
    const idx = Math.floor(relativeY / OVERLAP_OFFSET);
    return Math.max(0, Math.min(idx, column.cards.length));
  };

  const { dropRef, isOver } = useDeckColumnDropTarget({
    deckId,
    sectionId,
    columnId: column._id,
    computeIndex
  });

  // useDragLayer fires on every pointer move during a drag, giving us a live offset
  // for the drop position indicator. useDrop's collect only fires on enter/leave/canDrop.
  const { dragClientOffset } = useDragLayer((monitor) => ({
    dragClientOffset: monitor.isDragging() ? monitor.getClientOffset() : null
  }));

  const isEmpty = column.cards.length === 0;
  const dropIndex = isOver && !isEmpty ? computeIndex(dragClientOffset) : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={(node) => {
            columnRef.current = node;
            if (typeof dropRef === "function") dropRef(node);
          }}
          data-testid={`deck-column-${column._id}`}
          className={cn(
            "relative flex flex-col min-w-min rounded-[5px] border p-1 transition-colors",
            isOver ? "border-primary bg-primary/10" : "border-transparent"
          )}
        >
          {isEmpty ? (
            <div
              className="rounded-md border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-xs text-muted-foreground"
              style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px` }}
            >
              Drop here
            </div>
          ) : (
            column.cards.map((card, i) => (
              <DeckCardImage
                key={card._id}
                deckId={deckId}
                deckName={deckName}
                sectionId={sectionId}
                columnId={column._id}
                card={card}
                physicalCardIds={column.cards.slice(i).map((c) => c._id)}
                cards={column.cards.slice(i).map((c) => c.card)}
                isFirst={i === 0}
                cardIndex={i}
                isBeingDragged={dragOriginIndex !== null && i >= dragOriginIndex}
                onDragIndexChange={setDragOriginIndex}
              />
            ))
          )}
          {dropIndex !== null && (
            <div
              className="absolute -left-2 -right-2 flex items-center pointer-events-none z-10"
              style={{ top: `${CONTAINER_OFFSET + dropIndex * OVERLAP_OFFSET - 5}px` }}
            >
              {/* Left arrow: ▶ pointing into the column */}
              <div className="w-0 h-0 shrink-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[8px] border-l-primary" />
              <div className="flex-1 h-1 bg-primary" />
              {/* Right arrow: ◀ pointing into the column */}
              <div className="w-0 h-0 shrink-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[8px] border-r-primary" />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!isEmpty}
          onClick={() => deleteColumn.mutate({ deckId, sectionId, columnId: column._id })}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete column{!isEmpty && " (empty it first)"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

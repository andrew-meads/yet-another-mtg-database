"use client";

import { SimpleCardArtView } from "@/components/CardArtView";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { DeckColumn as DeckColumnData } from "@/types/Deck";
import { cn } from "@/lib/utils";
import { useRef } from "react";
import { useCardSelection } from "@/context/CardSelectionContext";
import { CARD_WIDTH, CARD_HEIGHT, OVERLAP_OFFSET, CONTAINER_OFFSET } from "./card-dimensions";
import { usePhysicalCardDragSource } from "@/hooks/drag-drop/usePhysicalCardDragSource";
import { useDeckColumnDropTarget } from "@/hooks/drag-drop/useDeckDropTargets";
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
  sectionId: string;
  column: DeckColumnData;
}

/** A single physical-card image within a column's overlapping stack. */
function DeckCardImage({
  deckId,
  sectionId,
  columnId,
  card,
  isFirst
}: {
  deckId: string;
  sectionId: string;
  columnId: string;
  card: DetailedPhysicalCard;
  isFirst: boolean;
}) {
  const { setSelectedCard } = useCardSelection();
  const deckCardOp = useDeckCardOp();
  const deleteCard = useDeletePhysicalCard();

  const { isDragging, dragRef } = usePhysicalCardDragSource({
    physicalCardIds: [card._id],
    card: card.card,
    sourceCollectionId: card.collectionId,
    sourceDeckId: deckId,
    origin: { type: "deck", sectionId, columnId }
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dragRef as unknown as React.Ref<HTMLDivElement>}
          className={cn(
            "shrink-0 relative select-none cursor-grab active:cursor-grabbing transition-all duration-200",
            isDragging && "opacity-40"
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
                    <span className="text-[10px] text-white truncate">{card.collectionName}</span>
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

export default function DeckColumn({ deckId, sectionId, column }: DeckColumnProps) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const deleteColumn = useDeleteColumn();

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

  const isEmpty = column.cards.length === 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={(node) => {
            columnRef.current = node;
            if (typeof dropRef === "function") dropRef(node);
          }}
          className={cn(
            "flex flex-col min-w-min rounded-[5px] border p-1 transition-colors",
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
                sectionId={sectionId}
                columnId={column._id}
                card={card}
                isFirst={i === 0}
              />
            ))
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

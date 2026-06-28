"use client";

import { SimpleCardArtView } from "@/components/CardArtView";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { MtgCard } from "@/types/MtgCard";
import { DeckColumn as DeckColumnData } from "@/types/Deck";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCardSelection } from "@/context/CardSelectionContext";
import { CARD_WIDTH, CARD_HEIGHT, OVERLAP_OFFSET, CONTAINER_OFFSET } from "./card-dimensions";
import { usePhysicalCardDragSource } from "@/hooks/drag-drop/usePhysicalCardDragSource";
import { PhysicalCardDragItem } from "@/hooks/drag-drop/Types";
import { useAltKeyRef } from "@/hooks/drag-drop/useAltKeyRef";
import { useDeckColumnDropTarget } from "@/hooks/drag-drop/useDeckDropTargets";
import { useDragLayer } from "react-dnd";
import { useDeckCardOp } from "@/hooks/react-query/useDeckCardOp";
import { useDeletePhysicalCard } from "@/hooks/react-query/useDeletePhysicalCard";
import { useDeleteColumn } from "@/hooks/react-query/useDeckColumns";
import { StickyNote, Tag, Library, Trash2, Layers, Sparkles } from "lucide-react";
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
  onDragChange,
  altRef
}: {
  deckId: string;
  deckName?: string;
  sectionId: string;
  columnId: string;
  card: DetailedPhysicalCard;
  /** The physical card ids to drag together: this card plus every card below it. */
  physicalCardIds: string[];
  /** Full card data for every card in the run (for the drag preview). */
  cards: MtgCard[];
  isFirst: boolean;
  cardIndex: number;
  isBeingDragged: boolean;
  /** Called when drag starts/ends; `single` reflects whether Alt was held at drag start. */
  onDragChange: (index: number | null, single: boolean) => void;
  altRef: React.RefObject<boolean>;
}) {
  const { setSelectedCard } = useCardSelection();
  const deckCardOp = useDeckCardOp();
  const deleteCard = useDeletePhysicalCard();

  const getItem = useCallback((): PhysicalCardDragItem => {
    const single = altRef.current;
    return {
      kind: "physical",
      physicalCardIds: single ? [physicalCardIds[0]] : physicalCardIds,
      card: card.card,
      cards: single ? [cards[0]] : cards,
      sourceCollectionId: card.collectionId,
      sourceDeckId: deckId,
      sourceCollectionName: card.collectionName,
      sourceDeckName: deckName,
      isEphemeral: card.isEphemeral,
      origin: { type: "deck", sectionId, columnId }
    };
  }, [altRef, physicalCardIds, cards, card, deckId, deckName, sectionId, columnId]);

  const { isDragging, dragRef } = usePhysicalCardDragSource({
    physicalCardIds,
    card: card.card,
    cards,
    sourceCollectionId: card.collectionId,
    sourceDeckId: deckId,
    sourceCollectionName: card.collectionName,
    sourceDeckName: deckName,
    isEphemeral: card.isEphemeral,
    origin: { type: "deck", sectionId, columnId },
    getItem
  });

  useEffect(() => {
    onDragChange(isDragging ? cardIndex : null, isDragging ? (altRef.current ?? false) : false);
  }, [isDragging, cardIndex, onDragChange, altRef]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dragRef as unknown as React.Ref<HTMLDivElement>}
          data-testid={`deck-card-${card._id}`}
          data-ephemeral={card.isEphemeral ? "true" : undefined}
          className={cn(
            "relative shrink-0 cursor-grab transition-all duration-200 select-none active:cursor-grabbing",
            isBeingDragged ? "blur-[1px] grayscale" : "hover:brightness-125"
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

          {/* Ephemeral badge: this card exists only in this deck (no collection). */}
          {card.isEphemeral && (
            <div className="absolute top-1 right-1" data-testid={`ephemeral-badge-${card._id}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 rounded bg-black/70 px-1 py-0.5">
                    <Sparkles className="size-3 shrink-0 text-white" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>Ephemeral — exists only in this deck</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Collection badge (which collection this physical card belongs to) */}
          {card.collectionName && (
            <div className="absolute top-1 left-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex max-w-[120px] items-center gap-1 rounded bg-black/70 px-1 py-0.5">
                    <Library className="size-3 shrink-0 text-white" />
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
                    <div className="rounded bg-black/70 p-1">
                      <StickyNote className="size-3 text-white" />
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
                    <div className="rounded bg-black/70 p-1">
                      <Tag className="size-3 text-white" />
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
        {/* Removing an ephemeral card deletes it entirely (it has no collection
            to fall back to), so a single action serves both purposes. */}
        <ContextMenuItem
          onClick={() => deckCardOp.mutate({ deckId, op: "remove", physicalCardId: card._id })}
        >
          <Layers className="mr-2 size-4" />
          Remove from deck
        </ContextMenuItem>
        {!card.isEphemeral && (
          <ContextMenuItem onClick={() => deleteCard.mutate(card._id)}>
            <Trash2 className="mr-2 size-4" />
            Delete card
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function DeckColumn({ deckId, deckName, sectionId, column }: DeckColumnProps) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const deleteColumn = useDeleteColumn();
  const altRef = useAltKeyRef();
  const [dragOriginIndex, setDragOriginIndex] = useState<number | null>(null);
  const [isSingleDrag, setIsSingleDrag] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const onDragChange = useCallback((index: number | null, single: boolean) => {
    setDragOriginIndex(index);
    setIsSingleDrag(single);
  }, []);

  const computeIndex = useCallback(
    (offset: { x: number; y: number } | null) => {
      const el = columnRef.current;
      if (!el || !offset) return column.cards.length;
      const rect = el.getBoundingClientRect();
      const relativeY = offset.y - rect.top - CONTAINER_OFFSET;
      const idx = Math.floor(relativeY / OVERLAP_OFFSET);
      return Math.max(0, Math.min(idx, column.cards.length));
    },
    [column.cards.length]
  );

  const { dropRef, isOver } = useDeckColumnDropTarget({
    deckId,
    sectionId,
    columnId: column._id,
    computeIndex
  });

  // useDragLayer fires on every pointer move during a drag, giving us a live offset
  // for the drop position indicator. useDrop's collect only fires on enter/leave/canDrop.
  const { dragClientOffset, isDragging } = useDragLayer((monitor) => ({
    dragClientOffset: monitor.isDragging() ? monitor.getClientOffset() : null,
    isDragging: monitor.isDragging()
  }));

  const isEmpty = column.cards.length === 0;

  // Derive the drop-indicator position from the live pointer offset (an external system
  // surfaced by useDragLayer) via an effect, rather than measuring the column ref during
  // render. setDropIndex here is the sanctioned "sync to an external system" use.
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  useEffect(() => {
    // Syncing the indicator to the live pointer offset (an external system from
    // useDragLayer) is the sanctioned external-subscription use of setState in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDropIndex(isOver && !isEmpty ? computeIndex(dragClientOffset) : null);
  }, [isOver, isEmpty, dragClientOffset, computeIndex]);

  return (
    <div
      ref={(node) => {
        columnRef.current = node;
        if (typeof dropRef === "function") dropRef(node);
      }}
      data-testid={`deck-column-${column._id}`}
      className={cn(
        "relative flex min-w-min flex-col rounded-[5px] border p-1 transition-colors",
        isOver ? "border-primary bg-primary/10" : "border-transparent"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isEmpty ? (
        <div
          className="border-muted-foreground/30 text-muted-foreground flex items-center justify-center rounded-md border-2 border-dashed text-xs"
          style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px` }}
        >
          {isHovered && !isDragging ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded p-2 transition-colors"
                  onClick={() => deleteColumn.mutate({ deckId, sectionId, columnId: column._id })}
                >
                  <Trash2 className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete column</TooltipContent>
            </Tooltip>
          ) : (
            "Drop here"
          )}
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
            isBeingDragged={
              dragOriginIndex !== null &&
              (isSingleDrag ? i === dragOriginIndex : i >= dragOriginIndex)
            }
            onDragChange={onDragChange}
            altRef={altRef}
          />
        ))
      )}
      {dropIndex !== null && (
        <div
          className="pointer-events-none absolute -inset-x-2 z-10 flex items-center"
          style={{ top: `${CONTAINER_OFFSET + dropIndex * OVERLAP_OFFSET - 5}px` }}
        >
          {/* Left arrow: ▶ pointing into the column */}
          <div className="border-l-primary size-0 shrink-0 border-y-[5px] border-l-[8px] border-y-transparent" />
          <div className="bg-primary h-1 flex-1" />
          {/* Right arrow: ◀ pointing into the column */}
          <div className="border-r-primary size-0 shrink-0 border-y-[5px] border-r-[8px] border-y-transparent" />
        </div>
      )}
    </div>
  );
}

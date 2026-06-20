"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MtgCard } from "@/types/MtgCard";
import { ManaCost } from "@/components/CardTextView";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Trash2,
  ChevronRight,
  StickyNote,
  Tag,
  Layers,
  Minus,
  Plus,
  GripVertical
} from "lucide-react";
import { usePhysicalCardDragSource } from "@/hooks/drag-drop/usePhysicalCardDragSource";
import { useAltKeyRef } from "@/hooks/drag-drop/useAltKeyRef";
import { dragCountForItem } from "@/hooks/drag-drop/dragCount";
import { PhysicalCardDragItem } from "@/hooks/drag-drop/Types";
import { useCreatePhysicalCard } from "@/hooks/react-query/useCreatePhysicalCard";
import { useRemoveCardGroup } from "@/hooks/react-query/useRemoveCardGroup";
import { useEffect, useRef, useState } from "react";
import EntryNotesAndTags from "../EntryNotesAndTags";
import { SetSvg } from "@/components/SetSvg";
import { cn } from "@/lib/utils";
import { CollectionGroupRow, COLLECTION_GRID } from "./grouping";

interface CollectionTableRowProps {
  collectionId: string;
  collectionName?: string;
  row: CollectionGroupRow;
  onClick?: (card: MtgCard) => void;
  isSelected?: boolean;
  isExpanded?: boolean;
  onExpand?: () => void;
  isSearchActive?: boolean;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
  onHoverMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onDragStateChange?: (isDragging: boolean) => void;
}

export default function CollectionTableRow({
  collectionId,
  collectionName,
  row,
  onClick,
  isSelected = false,
  isExpanded = false,
  onExpand,
  isSearchActive = false,
  onHoverEnter,
  onHoverLeave,
  onHoverMove,
  onDragStateChange
}: CollectionTableRowProps) {
  const { card } = row;
  const isLoose = row.deckId === null;

  const createCard = useCreatePhysicalCard();
  const removeGroup = useRemoveCardGroup();

  // How many copies the next drag carries. Defaults to the whole row so the existing
  // "drag the row" behavior is unchanged unless the user dials it down.
  const [dragCount, setDragCount] = useState(row.quantity);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDragCount(row.quantity), [row.quantity]);

  // getItem runs at drag start and is captured once by useDrag, so read the live count
  // and Alt state from refs rather than closed-over values.
  const dragCountRef = useRef(dragCount);
  useEffect(() => {
    dragCountRef.current = dragCount;
  }, [dragCount]);
  const altRef = useAltKeyRef();

  const { isDragging, dragRef } = usePhysicalCardDragSource({
    physicalCardIds: row.physicalCardIds,
    card,
    sourceCollectionId: collectionId,
    sourceDeckId: row.deckId,
    sourceCollectionName: collectionName,
    sourceDeckName: row.deckName,
    origin: { type: "collection" },
    canDrag: !isSearchActive,
    getItem: (): PhysicalCardDragItem => ({
      kind: "physical",
      physicalCardIds: dragCountForItem({
        ids: row.physicalCardIds,
        count: dragCountRef.current,
        altHeld: altRef.current
      }),
      card,
      sourceCollectionId: collectionId,
      sourceDeckId: row.deckId,
      sourceCollectionName: collectionName,
      sourceDeckName: row.deckName,
      origin: { type: "collection" }
    })
  });

  useEffect(() => {
    onDragStateChange?.(isDragging);
    // Once a drag finishes, snap the count back to the full row so the next drag defaults
    // to "all" again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isDragging) setDragCount(row.quantity);
  }, [isDragging, onDragStateChange, row.quantity]);

  const [localQty, setLocalQty] = useState(String(row.quantity));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setLocalQty(String(row.quantity)), [row.quantity]);

  const addCopies = (n: number) => {
    if (n <= 0) return;
    createCard.mutate({
      cardId: card.id,
      collectionId,
      notes: row.notes,
      tags: row.tags,
      quantity: n
    });
  };

  const removeCopies = (n: number) => {
    if (n <= 0) return;
    removeGroup.mutate({
      collectionId,
      cardId: card.id,
      notes: row.notes,
      tags: row.tags,
      deckId: row.deckId,
      quantity: n
    });
  };

  const commitQuantity = () => {
    const next = parseInt(localQty, 10);
    if (isNaN(next) || next === row.quantity) {
      setLocalQty(String(row.quantity));
      return;
    }
    if (next > row.quantity) addCopies(next - row.quantity);
    else removeCopies(row.quantity - next);
  };

  // Mana costs (handling double-faced cards)
  const faces = card.card_faces || [];
  const manaCosts =
    faces.length > 0
      ? faces.map((f) => f.mana_cost).filter((c): c is string => Boolean(c))
      : card.mana_cost
        ? [card.mana_cost]
        : [];

  const powerToughness = card.power && card.toughness ? `${card.power}/${card.toughness}` : "—";

  const nameText = card.flavor_name ? (
    <>
      {card.flavor_name} <span className="italic">({card.name})</span>
    </>
  ) : (
    card.name
  );

  return (
    <div className={cn("border-b", isDragging && "opacity-40")}>
      <div
        ref={dragRef as unknown as React.Ref<HTMLDivElement>}
        data-testid={`collection-row-${row.key}`}
        className={cn(
          "group hover:bg-muted/50 relative grid cursor-pointer items-center gap-2 px-2 py-1.5 text-sm",
          isSelected && "bg-accent"
        )}
        style={{ gridTemplateColumns: COLLECTION_GRID }}
        onClick={() => onClick?.(card)}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
        onMouseMove={onHoverMove}
      >
        {/* Expand */}
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={(e) => {
            e.stopPropagation();
            onExpand?.();
          }}
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")} />
        </Button>

        {/* Name — outer wrapper is the positioning context for the drag-count control so the
            control sits at the right edge of this column (just before mana cost). The inner
            div carries overflow:hidden for text truncation; the control lives in the outer
            wrapper so it is not clipped by that overflow. */}
        <div className="relative flex items-center self-stretch">
          <div className="flex w-full items-center gap-2 truncate font-medium">
            <span className="truncate">{nameText}</span>
            {row.notes && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <StickyNote className="text-muted-foreground shrink-0 size-3" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-xs">{row.notes}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {row.tags && row.tags.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Tag className="text-muted-foreground shrink-0 size-3" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-xs">{row.tags.join(", ")}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div
            className="bg-background/95 pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center gap-0.5 rounded-md border px-1 opacity-0 shadow-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              e.stopPropagation();
              setDragCount((n) =>
                e.deltaY < 0 ? Math.min(row.quantity, n + 1) : Math.max(1, n - 1)
              );
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="text-muted-foreground flex h-6 w-5 cursor-grab items-center justify-center"
                  aria-label="Drag handle"
                >
                  <GripVertical className="size-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Drag {dragCount} {dragCount === 1 ? "copy" : "copies"} — hold Alt to drag one
              </TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={dragCount <= 1}
              onClick={() => setDragCount((n) => Math.max(1, n - 1))}
              aria-label="Decrease drag amount"
            >
              <Minus className="size-3" />
            </Button>
            <span className="w-5 text-center text-xs font-semibold tabular-nums">{dragCount}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={dragCount >= row.quantity}
              onClick={() => setDragCount((n) => Math.min(row.quantity, n + 1))}
              aria-label="Increase drag amount"
            >
              <Plus className="size-3" />
            </Button>
          </div>
        </div>

        {/* Mana */}
        <div className="flex items-center justify-center gap-1">
          {manaCosts.map((cost, idx) => (
            <div key={idx} className="flex items-center gap-1">
              {idx > 0 && <span className="text-muted-foreground">{"//"}</span>}
              <ManaCost cost={cost} />
            </div>
          ))}
        </div>

        {/* Type */}
        <div className="text-muted-foreground truncate">
          {card.type_line.length > 40 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{card.type_line.substring(0, 40)}...</span>
              </TooltipTrigger>
              <TooltipContent>{card.type_line}</TooltipContent>
            </Tooltip>
          ) : (
            card.type_line
          )}
        </div>

        {/* Set / rarity */}
        <div className="flex justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="inline-flex items-center justify-center">
                <SetSvg setCode={card.set} rarityCode={card.rarity} width={28} height={28} />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {card.set_name}{" "}
              <em className="text-muted-foreground text-xs">({card.set.toUpperCase()})</em>{" "}
              {card.rarity}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* CMC */}
        <div className="text-center">{card.cmc}</div>

        {/* P/T */}
        <div className="text-center">{powerToughness}</div>

        {/* Deck badge */}
        <div className="flex justify-center">
          {row.deckId ? (
            <span className="bg-secondary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
              <Layers className="size-3" />
              <span className="max-w-24 truncate">{row.deckName ?? "Deck"}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>

        {/* Quantity */}
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {isLoose ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => removeCopies(1)}
                aria-label="Remove one"
              >
                <Minus className="size-3.5" />
              </Button>
              <Input
                type="number"
                min="0"
                value={localQty}
                onChange={(e) => setLocalQty(e.target.value)}
                onBlur={commitQuantity}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitQuantity();
                }}
                className="w-14 text-center font-semibold"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => addCopies(1)}
                aria-label="Add one"
              >
                <Plus className="size-3.5" />
              </Button>
            </>
          ) : (
            <span className="w-8 text-center font-semibold">{row.quantity}</span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => removeCopies(row.quantity)}
                aria-label="Delete all copies"
              >
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isLoose
                ? "Delete these copies"
                : "Delete these copies (removes them from the deck too)"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {isExpanded && (
        <div className="bg-muted/30 p-4">
          <EntryNotesAndTags
            notes={row.notes}
            tags={row.tags}
            physicalCardIds={row.physicalCardIds}
          />
        </div>
      )}
    </div>
  );
}

"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MtgCard } from "@/types/MtgCard";
import { ManaCost } from "@/components/CardTextView";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, ChevronRight, StickyNote, Tag, Layers, Minus, Plus } from "lucide-react";
import { usePhysicalCardDragSource } from "@/hooks/drag-drop/usePhysicalCardDragSource";
import { useCreatePhysicalCard } from "@/hooks/react-query/useCreatePhysicalCard";
import { useRemoveCardGroup } from "@/hooks/react-query/useRemoveCardGroup";
import { useEffect, useState } from "react";
import EntryNotesAndTags from "../EntryNotesAndTags";
import { SetSvg } from "@/components/SetSvg";
import { cn } from "@/lib/utils";
import { CollectionGroupRow, COLLECTION_GRID } from "./grouping";

interface CollectionTableRowProps {
  collectionId: string;
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

  const { isDragging, dragRef } = usePhysicalCardDragSource({
    physicalCardIds: row.physicalCardIds,
    card,
    sourceCollectionId: collectionId,
    sourceDeckId: row.deckId,
    origin: { type: "collection" },
    canDrag: !isSearchActive
  });

  useEffect(() => {
    onDragStateChange?.(isDragging);
  }, [isDragging, onDragStateChange]);

  const [localQty, setLocalQty] = useState(String(row.quantity));
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
        className={cn(
          "grid items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/50 text-sm",
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
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onExpand?.();
          }}
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")} />
        </Button>

        {/* Name */}
        <div className="flex items-center gap-2 font-medium truncate">
          <span className="truncate">{nameText}</span>
          {row.notes && (
            <Tooltip>
              <TooltipTrigger asChild>
                <StickyNote className="h-3 w-3 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs text-xs">{row.notes}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {row.tags && row.tags.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs text-xs">{row.tags.join(", ")}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Mana */}
        <div className="flex justify-center items-center gap-1">
          {manaCosts.map((cost, idx) => (
            <div key={idx} className="flex items-center gap-1">
              {idx > 0 && <span className="text-muted-foreground">//</span>}
              <ManaCost cost={cost} />
            </div>
          ))}
        </div>

        {/* Type */}
        <div className="truncate text-muted-foreground">
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
              <em className="text-xs text-muted-foreground">({card.set.toUpperCase()})</em>{" "}
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
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
              <Layers className="h-3 w-3" />
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
                className="h-7 w-7"
                onClick={() => removeCopies(1)}
                aria-label="Remove one"
              >
                <Minus className="h-3.5 w-3.5" />
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
                className="h-7 w-7"
                onClick={() => addCopies(1)}
                aria-label="Add one"
              >
                <Plus className="h-3.5 w-3.5" />
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
                className="h-7 w-7"
                onClick={() => removeCopies(row.quantity)}
                aria-label="Delete all copies"
              >
                <Trash2 className="h-4 w-4" />
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

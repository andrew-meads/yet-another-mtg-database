"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MtgCard } from "@/types/MtgCard";
import { ManaCost } from "@/components/CardTextView";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, ChevronRight, StickyNote, Tag } from "lucide-react";
import { DetailedCardEntry } from "@/types/CardCollection";
import { useCardEntryDragSource } from "@/hooks/drag-drop/useCardEntryDragSource";
import { useCardEntryQuantity } from "@/hooks/useCardEntryQuantity";
import { useEffect } from "react";
import EntryNotesAndTags from "./EntryNotesAndTags";

/**
 * Props for CollectionTableRow component
 */
interface CollectionTableRowProps {
  collectionId: string;
  /** The entry in this row */
  entry: DetailedCardEntry;
  /** Row index for reordering */
  rowIndex: number;
  /** Callback when row is clicked */
  onClick?: (card: MtgCard) => void;
  /** Whether this row is currently selected */
  isSelected?: boolean;
  /** Whether this row is currently expanded */
  isExpanded?: boolean;
  /** Callback to toggle expansion */
  onExpand?: () => void;
  /** Whether search is currently active in the parent table */
  isSearchActive?: boolean;
  /** Callback when mouse enters the row */
  onHoverEnter?: () => void;
  /** Callback when mouse leaves the row */
  onHoverLeave?: () => void;
  /** Callback when mouse moves within the row */
  onHoverMove?: (e: React.MouseEvent<HTMLTableRowElement>) => void;
  /** Callback to notify parent when drag state changes */
  onDragStateChange?: (isDragging: boolean) => void;
}

/**
 * Individual table row component for displaying a single card in a collection
 *
 * Features:
 * - Displays card attributes across multiple columns
 * - Handles double-faced cards with "//" separator
 * - Editable quantity field with trash can for removal
 * - Hover preview popup support
 */
export default function CollectionTableRow({
  collectionId,
  entry,
  rowIndex,
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
  // === CARD DATA EXTRACTION (needed early for hooks) ===
  const { card, quantity } = entry;

  // === QUANTITY MANAGEMENT ===
  const { localQuantity, handleUserQuantityChange, handleImmediateQuantityChange } =
    useCardEntryQuantity({
      collectionId,
      cardIndex: rowIndex,
      initialQuantity: entry.quantity
    });

  // === DRAG AND DROP ===
  const { isDragging, dragRef } = useCardEntryDragSource({
    sourceCollectionId: collectionId,
    sourceIndex: rowIndex,
    entry,
    canDrag: !isSearchActive
  });

  // Notify parent component when drag state changes (used to hide hover popup)
  useEffect(() => {
    onDragStateChange?.(isDragging);
  }, [isDragging, onDragStateChange]);

  // === MANA COST AND DISPLAY ===

  // Extract mana costs (handling double-faced cards)
  const faces = card.card_faces || [];
  const manaCosts =
    faces.length > 0
      ? faces.map((f) => f.mana_cost).filter((c): c is string => Boolean(c))
      : card.mana_cost
        ? [card.mana_cost]
        : [];

  // Power/Toughness
  const renderPowerToughness = () => {
    if (card.power && card.toughness) {
      return `${card.power}/${card.toughness}`;
    }
    return "—";
  };

  // Display flavor name if present, with real name in brackets and italics
  const nameText = card.flavor_name ? (
    <>
      {card.flavor_name} <span className="italic">({card.name})</span>
    </>
  ) : (
    card.name
  );

  const displayName = (
    <div className="flex items-center gap-2">
      <span>{nameText}</span>
      {entry.notes && (
        <Tooltip>
          <TooltipTrigger asChild>
            <StickyNote className="h-3 w-3 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs text-xs">{entry.notes}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {entry.tags && entry.tags.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Tag className="h-3 w-3 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs text-xs">{entry.tags.join(", ")}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  return (
    <>
      <TableRow
        className={`cursor-pointer hover:bg-muted/50 ${isSelected ? "bg-accent" : ""}`}
        onClick={() => onClick?.(card)}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
        onMouseMove={onHoverMove}
        ref={dragRef as unknown as React.LegacyRef<HTMLTableRowElement>}
        data-row-index={rowIndex}
      >
        <TableCell className="p-2 text-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onExpand?.();
            }}
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            />
          </Button>
        </TableCell>
        <TableCell className="font-medium">{displayName}</TableCell>
        <TableCell className="text-center">
          {manaCosts.length > 0 && (
            <div className="flex justify-center items-center gap-1">
              {manaCosts.map((cost, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  {idx > 0 && <span className="text-muted-foreground">//</span>}
                  <ManaCost cost={cost} />
                </div>
              ))}
            </div>
          )}
        </TableCell>
        <TableCell className="text-sm">
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
        </TableCell>
        <TableCell className="text-center text-xs uppercase">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{card.set}</span>
            </TooltipTrigger>
            <TooltipContent>{card.set_name}</TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell className="text-center">{card.cmc}</TableCell>
        <TableCell className="text-center">{renderPowerToughness()}</TableCell>
        <TableCell className="text-center">{card.loyalty || "—"}</TableCell>
        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center gap-1">
            <Input
              type="number"
              min="1"
              value={localQuantity}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) handleUserQuantityChange(val);
              }}
              className="w-16 text-center font-semibold"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 cursor-pointer"
              onClick={() => handleImmediateQuantityChange(0)}
              aria-label="Remove card"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={9} className="bg-muted/30 p-4 text-sm">
            <EntryNotesAndTags
              notes={entry.notes}
              tags={entry.tags}
              collectionId={collectionId}
              cardIndex={rowIndex}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

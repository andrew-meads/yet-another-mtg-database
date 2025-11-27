"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { MtgCard } from "@/types/MtgCard";
import { ManaCost } from "@/components/CardTextView";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Trash2, ChevronRight, StickyNote, Tag, ArrowRightLeft, FolderInput } from "lucide-react";
import { DetailedCardEntry } from "@/types/CardCollection";
import { useCardEntryDragSource } from "@/hooks/drag-drop/useCardEntryDragSource";
import { useCardEntryQuantity } from "@/hooks/useCardEntryQuantity";
import { useOpenCollectionsContext } from "@/context/OpenCollectionsContext";
import { getCollectionIcon } from "@/lib/collectionUtils";
import { useEffect, useState } from "react";
import EntryNotesAndTags from "../EntryNotesAndTags";
import { on } from "events";

/**
 * Component for move to collection menu item with quantity slider
 */
interface MoveToCollectionMenuItemProps {
  /** Collection to move to */
  targetCollectionName: string;
  /** Icon to display (optional) */
  icon?: React.ReactNode;
  /** Maximum quantity available to move */
  maxQuantity: number;
  /** Callback when move is triggered */
  onMove: (quantity: number) => void;
  /** Whether this item is disabled */
  disabled?: boolean;
  /** Optional keyboard hint */
  keyboardHint?: string;
}

function MoveToCollectionMenuItem({
  targetCollectionName,
  icon,
  maxQuantity,
  onMove,
  disabled = false,
  keyboardHint
}: MoveToCollectionMenuItemProps) {
  const [quantity, setQuantity] = useState(1);

  // Reset quantity when max changes
  useEffect(() => {
    setQuantity(Math.min(quantity, maxQuantity));
  }, [maxQuantity]);

  const handleMove = () => {
    onMove(quantity);
    setQuantity(1); // Reset after move
  };

  const handleQuantityChange = (value: number[]) => {
    setQuantity(value[0]);
  };

  return (
    <ContextMenuItem
      onSelect={(e) => {
        e.preventDefault(); // Prevent menu from closing
      }}
      disabled={disabled}
    >
      <div className="flex flex-col flex-1 gap-2">
        <div className="flex items-center">
          {icon}
          {targetCollectionName}
          {keyboardHint && (
            <span className="ml-auto pl-4 text-xs text-muted-foreground">{keyboardHint}</span>
          )}
        </div>
        {maxQuantity > 1 && !disabled && (
          <div className="ml-6 space-y-1">
            <Slider
              value={[quantity]}
              onValueChange={handleQuantityChange}
              min={1}
              max={maxQuantity}
              step={1}
              className="w-full"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {quantity} {quantity === 1 ? "card" : "cards"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMove();
                }}
              >
                Move
              </Button>
            </div>
          </div>
        )}
        {maxQuantity === 1 && !disabled && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs ml-6"
            onClick={(e) => {
              e.stopPropagation();
              handleMove();
            }}
          >
            Move
          </Button>
        )}
      </div>
    </ContextMenuItem>
  );
}

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
  /** Callback when move to collection is triggered */
  onMoveToCollection?: (
    entry: DetailedCardEntry,
    rowIndex: number,
    quantity: number,
    targetCollectionId?: string
  ) => void;
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
  onDragStateChange,
  onMoveToCollection
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

  // === CONTEXT ===
  const { activeCollection, openCollections } = useOpenCollectionsContext();

  // Filter out current collection from move options
  const otherCollections = openCollections.filter((c) => c._id !== collectionId);

  // === HANDLERS ===
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveToCollection?.(entry, rowIndex, 1);
                      }}
                      disabled={activeCollection?._id === collectionId}
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="flex flex-col">
                      <span>Move to active collection</span>
                      {activeCollection && activeCollection._id !== collectionId && (
                        <span className="text-xs text-muted-foreground">
                          {activeCollection.name}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">Press + or =</span>
                    </div>
                  </TooltipContent>
                </Tooltip>
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          {activeCollection && (
            <MoveToCollectionMenuItem
              targetCollectionName={`Move to ${activeCollection.name}`}
              icon={<ArrowRightLeft className="mr-2 h-4 w-4" />}
              maxQuantity={entry.quantity}
              onMove={(quantity) => onMoveToCollection?.(entry, rowIndex, quantity, undefined)}
              disabled={activeCollection._id === collectionId}
              keyboardHint="+ or ="
            />
          )}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput className="mr-2 h-4 w-4" />
              Move to collection
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {otherCollections.map((collection) => (
                <MoveToCollectionMenuItem
                  key={collection._id}
                  targetCollectionName={collection.name}
                  icon={getCollectionIcon(collection.collectionType, "h-4 w-4 mr-2")}
                  maxQuantity={entry.quantity}
                  onMove={(quantity) =>
                    onMoveToCollection?.(entry, rowIndex, quantity, collection._id)
                  }
                />
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>
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

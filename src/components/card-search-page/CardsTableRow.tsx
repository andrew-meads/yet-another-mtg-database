"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
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
import { useEffect } from "react";
import { ManaCost } from "@/components/CardTextView";
import { useCardDragSource } from "@/hooks/drag-drop/useCardDragSource";
import { useOpenCollectionsContext } from "@/context/OpenCollectionsContext";
import { getCollectionIcon } from "@/lib/collectionUtils";
import { Star, Plus } from "lucide-react";
import clsx from "clsx";

/**
 * Props for CardsTableRow component
 */
interface CardsTableRowProps {
  /** The MTG card to display in this row */
  card: MtgCard;
  /** Callback when row is clicked */
  onClick?: (card: MtgCard) => void;
  /** Callback when mouse enters the row */
  onHoverEnter?: () => void;
  /** Callback when mouse leaves the row */
  onHoverLeave?: () => void;
  /** Callback when mouse moves within the row */
  onHoverMove?: (e: React.MouseEvent<HTMLTableRowElement>) => void;
  /** Callback to notify parent when drag state changes */
  onDragStateChange?: (isDragging: boolean) => void;
  /** Callback when add to collection button is clicked */
  onAddToCollection?: (card: MtgCard, collectionId?: string) => void;
  /** Whether this row is currently selected */
  isSelected?: boolean;
  /** Ref for scroll-into-view functionality (keyboard navigation) */
  rowRef?: React.RefObject<HTMLTableRowElement | null>;
}

/**
 * Individual table row component for displaying a single MTG card
 *
 * Features:
 * - Draggable via react-dnd for adding cards to collections
 * - Displays card attributes across multiple columns
 * - Handles double-faced cards with "//" separator
 * - Visual feedback when selected or being dragged
 * - Hover preview popup support
 */
export default function CardsTableRow({
  card,
  onClick,
  onHoverEnter,
  onHoverLeave,
  onHoverMove,
  onDragStateChange,
  onAddToCollection,
  isSelected,
  rowRef
}: CardsTableRowProps) {
  // === DRAG AND DROP ===
  // Make the row draggable using react-dnd
  const { isDragging, dragRef } = useCardDragSource(card);

  // === CONTEXT ===
  // Get open collections from context
  const { activeCollection, openCollections } = useOpenCollectionsContext();

  // Notify parent component when drag state changes (used to hide hover popup)
  useEffect(() => {
    onDragStateChange?.(isDragging);
  }, [isDragging, onDragStateChange]);

  // === HANDLERS ===
  const handleAddToCollection = () => {
    onAddToCollection?.(card, undefined);
  };

  // Combine dragRef (for react-dnd) and rowRef (for scroll-into-view) into a single ref
  const combinedRef = (node: HTMLTableRowElement | null) => {
    // Apply drag ref
    if (typeof dragRef === "function") {
      dragRef(node);
    } else if (dragRef) {
      (dragRef as React.MutableRefObject<HTMLTableRowElement | null>).current = node;
    }

    // Apply row ref for keyboard navigation scrolling
    if (rowRef) {
      (rowRef as React.MutableRefObject<HTMLTableRowElement | null>).current = node;
    }
  };

  // === CARD DATA EXTRACTION ===
  // Extract values from card_faces if present (for double-faced cards), otherwise use card-level values
  const faces = card.card_faces || [];

  // Mana cost: show single face cost or both with "//"
  const manaCosts =
    faces.length > 0
      ? faces.map((f) => f.mana_cost).filter((c): c is string => Boolean(c))
      : card.mana_cost
        ? [card.mana_cost]
        : [];

  // Power/Toughness: combine as "P/T" per face, then join with "//" for double-faced cards
  const powerToughness =
    faces.length > 0
      ? faces
          .filter((f) => f.power && f.toughness)
          .map((f) => `${f.power}/${f.toughness}`)
          .join(" // ")
      : card.power && card.toughness
        ? `${card.power}/${card.toughness}`
        : "—";

  // Loyalty: show both faces if present, separated by "//"
  const loyalties =
    faces.length > 0
      ? faces.map((f) => f.loyalty).filter(Boolean)
      : card.loyalty
        ? [card.loyalty]
        : [];

  const loyalty = loyalties.length > 0 ? loyalties.join(" // ") : "—";

  // Display flavor name if present, with real name in brackets and italics
  const displayName = card.flavor_name ? (
    <>
      {card.flavor_name} <span className="italic">({card.name})</span>
    </>
  ) : (
    card.name
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableRow
          ref={combinedRef as unknown as React.LegacyRef<HTMLTableRowElement>}
          className={clsx(
            "cursor-pointer",
            isDragging && "opacity-50",
            isSelected && "bg-primary/10 hover:bg-primary/15"
          )}
          onClick={() => onClick?.(card)}
          onMouseEnter={onHoverEnter}
          onMouseLeave={onHoverLeave}
          onMouseMove={onHoverMove}
        >
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
      <TableCell>
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
      <TableCell className="text-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{card.set.toUpperCase()}</span>
          </TooltipTrigger>
          <TooltipContent>{card.set_name}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="text-center">{card.cmc}</TableCell>
      <TableCell className="text-center">{powerToughness}</TableCell>
      <TableCell className="text-center">{loyalty}</TableCell>
      <TableCell className="w-[50px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                handleAddToCollection();
              }}
            >
              <Star className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex flex-col">
              <span>Add to active collection</span>
              {activeCollection && (
                <span className="text-xs text-muted-foreground">{activeCollection.name}</span>
              )}
              <span className="text-xs text-muted-foreground">Press + or =</span>
            </div>
          </TooltipContent>
        </Tooltip>
      </TableCell>
    </TableRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleAddToCollection}>
          <div className="flex flex-col flex-1">
            <div className="flex items-center">
              <Star className="mr-2 h-4 w-4" />
              Add to active collection
              <span className="ml-auto pl-4 text-xs text-muted-foreground">+ or =</span>
            </div>
            {activeCollection && (
              <span className="ml-6 text-xs text-muted-foreground">{activeCollection.name}</span>
            )}
          </div>
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Plus className="mr-2 h-4 w-4" />
            Add to collection
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {openCollections.map((collection) => (
              <ContextMenuItem
                key={collection._id}
                onClick={() => onAddToCollection?.(card, collection._id)}
              >
                {getCollectionIcon(collection.collectionType, "h-4 w-4 mr-2")}
                {collection.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}

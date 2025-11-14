"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MtgCard } from "@/types/MtgCard";
import { useEffect } from "react";
import { ManaCost } from "@/components/CardTextView";
import { useCardDragSource } from "@/hooks/useCardDragSource";
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
  isSelected,
  rowRef
}: CardsTableRowProps) {
  // === DRAG AND DROP ===
  // Make the row draggable using react-dnd
  const { isDragging, dragRef } = useCardDragSource(card);

  // Notify parent component when drag state changes (used to hide hover popup)
  useEffect(() => {
    onDragStateChange?.(isDragging);
  }, [isDragging, onDragStateChange]);

  // Combine dragRef (for react-dnd) and rowRef (for scroll-into-view) into a single ref
  const combinedRef = (node: HTMLTableRowElement | null) => {
    // Apply drag ref
    if (typeof dragRef === 'function') {
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
      <TableCell>{card.type_line}</TableCell>
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
    </TableRow>
  );
}

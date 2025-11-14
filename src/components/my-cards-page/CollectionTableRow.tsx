"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import { MtgCard } from "@/types/MtgCard";
import { ManaCost } from "@/components/CardTextView";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

/**
 * Props for CollectionTableRow component
 */
interface CollectionTableRowProps {
  /** The MTG card to display in this row */
  card: MtgCard;
  /** The quantity of this card in the collection */
  quantity: number;
  /** Callback when row is clicked */
  onClick?: (card: MtgCard) => void;
  /** Callback when mouse enters the row */
  onHoverEnter?: () => void;
  /** Callback when mouse leaves the row */
  onHoverLeave?: () => void;
  /** Callback when mouse moves within the row */
  onHoverMove?: (e: React.MouseEvent<HTMLTableRowElement>) => void;
  /** Callback when quantity changes */
  onQuantityChange?: (cardId: string, newQuantity: string) => void;
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
  card,
  quantity,
  onClick,
  onHoverEnter,
  onHoverLeave,
  onHoverMove,
  onQuantityChange
}: CollectionTableRowProps) {
  // === CARD DATA EXTRACTION ===
  
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

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => onClick?.(card)}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      onMouseMove={onHoverMove}
    >
      <TableCell className="font-medium">
        {card.name}
        {card.card_faces && card.card_faces.length > 1 && (
          <span className="text-muted-foreground text-xs ml-2">
            // {card.card_faces[1].name}
          </span>
        )}
      </TableCell>
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
      <TableCell className="text-sm">{card.type_line}</TableCell>
      <TableCell className="text-center text-xs uppercase">{card.set}</TableCell>
      <TableCell className="text-center">{card.cmc}</TableCell>
      <TableCell className="text-center">{renderPowerToughness()}</TableCell>
      <TableCell className="text-center">{card.loyalty || "—"}</TableCell>
      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-1">
          <Input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => onQuantityChange?.(card.id, e.target.value)}
            className="w-16 text-center font-semibold"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 cursor-pointer"
            onClick={() => onQuantityChange?.(card.id, "0")}
            aria-label="Remove card"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

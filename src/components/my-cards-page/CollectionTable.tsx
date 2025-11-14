"use client";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { CardCollectionWithCards } from "@/types/CardCollection";
import { MtgCard } from "@/types/MtgCard";
import { useState, useRef } from "react";
import CardPopup from "@/components/CardPopup";
import { useCardSelection } from "@/context/CardSelectionContext";
import { useUpdateCardQuantities } from "@/hooks/useUpdateCardQuantities";
import CollectionTableRow from "@/components/my-cards-page/CollectionTableRow";

/**
 * Props for the CollectionTable component
 */
export interface CollectionTableProps {
  /** Collection with detailed card information */
  collection: CardCollectionWithCards;
  /** Optional maximum height for the table container */
  maxHeight?: string;
}

/**
 * Table component for displaying cards in a collection
 *
 * Similar to CardsTable but includes a Quantity column showing
 * how many copies of each card are in the collection.
 */
export default function CollectionTable({ collection, maxHeight }: CollectionTableProps) {
  // === STATE MANAGEMENT ===

  // Hover preview popup: tracks which card is being hovered and mouse position
  const [hovered, setHovered] = useState<{ card: MtgCard; pos: { x: number; y: number } } | null>(
    null
  );

  // Card selection context
  const { setSelectedCard } = useCardSelection();

  // Mutation hook for updating card quantities
  const { mutate: updateCardQuantities } = useUpdateCardQuantities();

  // === REFS ===

  // Track last mouse position for hover popup positioning
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Timer for delayed hover popup display (500ms)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // === HELPER FUNCTIONS ===

  /**
   * Start hover timer when mouse enters a row
   * Popup appears after 500ms if mouse remains on row
   */
  const handleRowEnter = (card: MtgCard) => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = setTimeout(() => {
      setHovered({ card, pos: lastMousePosRef.current });
    }, 500);
  };

  /**
   * Cancel hover timer and hide popup when mouse leaves a row
   */
  const handleRowLeave = () => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
    setHovered(null);
  };

  /**
   * Track mouse position for hover popup placement
   */
  const handleRowMove = (e: React.MouseEvent<HTMLTableRowElement>) => {
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  /**
   * Handle quantity change for a card
   * Accepts 0 to remove the card from the collection
   */
  const handleQuantityChange = (cardId: string, newQuantity: string) => {
    const quantity = parseInt(newQuantity, 10);

    // Validate input (minimum 0, where 0 means remove)
    if (isNaN(quantity) || quantity < 0) {
      return;
    }

    // Update via API
    updateCardQuantities({
      collectionId: collection._id,
      modifications: [
        {
          cardId,
          operator: "set",
          amount: quantity
        }
      ]
    });
  };

  // === EARLY RETURNS FOR SPECIAL STATES ===

  if (!collection.cardsDetailed || collection.cardsDetailed.length === 0) {
    return (
      <div className="rounded-md border bg-muted/50 p-8 text-center text-muted-foreground">
        No cards in this collection
      </div>
    );
  }

  // === CONTAINER STYLING ===

  const containerClass = maxHeight
    ? "rounded-md border overflow-hidden flex flex-col"
    : "h-full rounded-md border overflow-hidden flex flex-col";
  const containerStyle = maxHeight ? { maxHeight } : undefined;

  // === RENDER ===

  return (
    <div style={containerStyle} className={containerClass}>
      <Table stickyHeader>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-center">Mana Cost</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-center">Set</TableHead>
            <TableHead className="text-center">CMC</TableHead>
            <TableHead className="text-center">P/T</TableHead>
            <TableHead className="text-center">Loyalty</TableHead>
            <TableHead className="text-center">Quantity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {collection.cardsDetailed.map((cardDetail) => (
            <CollectionTableRow
              key={`${cardDetail.card.id}-${cardDetail.quantity}`}
              card={cardDetail.card}
              quantity={cardDetail.quantity}
              onClick={setSelectedCard}
              onHoverEnter={() => handleRowEnter(cardDetail.card)}
              onHoverLeave={handleRowLeave}
              onHoverMove={handleRowMove}
              onQuantityChange={handleQuantityChange}
            />
          ))}
        </TableBody>
      </Table>
      {/* Show hover popup when hovering */}
      {hovered && <CardPopup card={hovered.card} position={hovered.pos} />}
    </div>
  );
}

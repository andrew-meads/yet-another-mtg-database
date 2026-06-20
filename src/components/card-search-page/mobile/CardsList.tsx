"use client";

import { MtgCard } from "@/types/MtgCard";
import CardListItem from "./CardListItem";

/**
 * Props for the CardsList component
 */
export interface CardsListProps {
  /** Array of MTG cards to display */
  cards: MtgCard[];
  /** Whether the list is currently loading data */
  isLoading?: boolean;
  /** Error object if loading failed */
  error?: Error | null;
}

/**
 * CardsList Component
 *
 * Mobile-optimized list view for displaying MTG cards.
 * Alternative to CardsTable for small screens.
 *
 * Features:
 * - Vertical scrolling list of cards
 * - Compact card items with thumbnails and key info
 * - Tap to select (integrates with CardSelectionContext)
 * - Loading and error states
 */
export default function CardsList({ cards, isLoading, error }: CardsListProps) {
  // === EARLY RETURNS FOR SPECIAL STATES ===
  if (error) {
    return (
      <div className="border-destructive bg-destructive/10 text-destructive rounded-md border p-4">
        <p className="font-semibold">Error loading cards</p>
        <p className="text-sm">{error.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-muted/50 text-muted-foreground rounded-md border p-8 text-center">
        Loading cards...
      </div>
    );
  }

  if (!cards || cards.length === 0) {
    return (
      <div className="bg-muted/50 text-muted-foreground rounded-md border p-8 text-center">
        No cards found
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="max-h-[calc(100vh-20rem)] overflow-y-auto">
        {cards.map((card, index) => (
          <CardListItem key={card.id} card={card} priority={index < 4} />
        ))}
      </div>
    </div>
  );
}

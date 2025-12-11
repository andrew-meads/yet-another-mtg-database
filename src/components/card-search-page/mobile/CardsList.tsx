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
      <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-destructive">
        <p className="font-semibold">Error loading cards</p>
        <p className="text-sm">{error.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-md border bg-muted/50 p-8 text-center text-muted-foreground">
        Loading cards...
      </div>
    );
  }

  if (!cards || cards.length === 0) {
    return (
      <div className="rounded-md border bg-muted/50 p-8 text-center text-muted-foreground">
        No cards found
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="overflow-y-auto max-h-[calc(100vh-20rem)]">
        {cards.map((card) => (
          <CardListItem key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

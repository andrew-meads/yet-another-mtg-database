"use client";

import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MtgCard } from "@/types/MtgCard";
import { useEffect, useRef, useState } from "react";
import { useCardSelection } from "@/context/CardSelectionContext";
import { useOpenCollectionsContext } from "@/context/OpenCollectionsContext";
import { useUpdateCollectionCards } from "@/hooks/react-query/useUpdateCollectionCards";
import CardPopup from "@/components/CardPopup";
import CardsTableRow from "@/components/card-search-page/CardsTableRow";

/**
 * Props for the CardsTable component
 */
export interface CardsTableProps {
  /** Array of MTG cards to display */
  cards: MtgCard[];
  /** Whether the table is currently loading data */
  isLoading?: boolean;
  /** Error object if loading failed */
  error?: Error | null;
  /** Optional maximum height for the table container */
  maxHeight?: string;
  /** Optional callback when a card is clicked. If not provided, uses CardSelectionContext */
  onCardClicked?: (card: MtgCard) => void;
}

/**
 * Main table component for displaying a list of MTG cards
 *
 * Features:
 * - Sticky header for easy column reference while scrolling
 * - Card selection via click (integrates with CardSelectionContext)
 * - Keyboard navigation with arrow keys (up/down)
 * - Auto-scroll to keep selected card visible during keyboard navigation
 * - Drag and drop support for adding cards to collections
 * - Hover preview popup after 500ms delay
 * - Loading and error states
 */
export default function CardsTable({
  cards,
  isLoading,
  error,
  maxHeight,
  onCardClicked
}: CardsTableProps) {
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

  return <InternalCardsTable cards={cards} maxHeight={maxHeight} onCardClicked={onCardClicked} />;
}

/**
 * Props for InternalCardsTable component
 */
interface InternalCardsTableProps {
  /** Array of MTG cards to display (guaranteed non-empty) */
  cards: MtgCard[];
  /** Optional maximum height for the table container */
  maxHeight?: string;
  /** Optional callback when a card is clicked. If not provided, uses CardSelectionContext */
  onCardClicked?: (card: MtgCard) => void;
}

/**
 * Internal table component that handles the actual rendering and logic
 * Separated from CardsTable to avoid violating Rules of Hooks with early returns
 */
function InternalCardsTable({ cards, maxHeight, onCardClicked }: InternalCardsTableProps) {
  // === STATE MANAGEMENT ===

  // Hover preview popup: tracks which card is being hovered and mouse position
  const [hovered, setHovered] = useState<{ card: MtgCard; pos: { x: number; y: number } } | null>(
    null
  );

  // Track if any row is currently being dragged (to hide hover popup)
  const [isAnyRowDragging, setIsAnyRowDragging] = useState(false);

  // === CONTEXT ===

  // Get active collection and open collections from context
  const { activeCollection, openCollections } = useOpenCollectionsContext();

  // Get mutation function for updating collection cards
  const { mutate: updateCardsInCollection } = useUpdateCollectionCards();

  // === REFS ===

  // Track last mouse position for hover popup positioning
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Timer for delayed hover popup display (500ms)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reference to the table container for keyboard focus detection
  const tableRef = useRef<HTMLDivElement>(null);

  // Map of card IDs to row refs for scroll-into-view functionality
  const rowRefsRef = useRef<Map<string, React.RefObject<HTMLTableRowElement | null>>>(new Map());

  // === HELPER FUNCTIONS ===

  /**
   * Get or create a ref for a specific card row
   * Used for keyboard navigation scroll behavior
   */
  const getRowRef = (cardId: string) => {
    if (!rowRefsRef.current.has(cardId)) {
      rowRefsRef.current.set(cardId, { current: null });
    }
    return rowRefsRef.current.get(cardId)!;
  };

  // === SELECTION CONTEXT ===

  // Get selected card state from context. Falls back to noop if provider not present.
  const { selectedCard, setSelectedCard } = useCardSelection();

  // Use provided click handler or default to setting selection context
  const clickHandler = onCardClicked ?? ((card: MtgCard) => setSelectedCard(card));

  // === KEYBOARD NAVIGATION ===

  /**
   * Handle arrow key navigation for card selection
   * - Only works when table has focus and a card is selected
   * - Arrow Down: select next card
   * - Arrow Up: select previous card
   * - + or =: add selected card to active collection
   * - Automatically scrolls selected row into view (centered)
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle keys if the table container has focus
      if (!tableRef.current?.contains(document.activeElement)) {
        return;
      }

      // Handle + or = keys to add to collection
      if ((e.key === "+" || e.key === "=") && selectedCard) {
        e.preventDefault();
        handleAddToCollection(selectedCard, undefined);
        return;
      }

      // Handle arrow keys for navigation
      if (!selectedCard) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();

        const currentIndex = cards.findIndex((c) => c.id === selectedCard.id);
        if (currentIndex === -1) return;

        let nextIndex: number;
        if (e.key === "ArrowDown") {
          nextIndex = Math.min(currentIndex + 1, cards.length - 1);
        } else {
          nextIndex = Math.max(currentIndex - 1, 0);
        }

        if (nextIndex !== currentIndex) {
          const nextCard = cards[nextIndex];
          setSelectedCard(nextCard);

          // Scroll the row into view centered in the viewport
          const rowRef = getRowRef(nextCard.id);
          if (rowRef.current) {
            rowRef.current.scrollIntoView({
              behavior: "smooth",
              block: "center"
            });
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedCard, cards, setSelectedCard]);

  // === HOVER POPUP MANAGEMENT ===

  /**
   * Clear hover popup when dragging starts to avoid visual conflicts
   */
  useEffect(() => {
    if (isAnyRowDragging) {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      setHovered(null);
    }
  }, [isAnyRowDragging]);

  /**
   * Cleanup hover timer on unmount
   */
  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, []);

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
   * CardPopup component applies its own offset and viewport clamping
   */
  const handleRowMove = (e: React.MouseEvent<HTMLTableRowElement>) => {
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  /**
   * Handle add to collection button click
   */
  const handleAddToCollection = (card: MtgCard, collectionId?: string) => {
    // Determine target collection
    let targetCollection;

    if (collectionId === undefined) {
      // Use active collection if no specific collection ID provided
      targetCollection = activeCollection;
    } else {
      // Find collection in open collections by ID
      targetCollection = openCollections.find((c) => c._id === collectionId);
    }

    // Return early if no valid collection found
    if (!targetCollection) return;

    // Add card to collection
    updateCardsInCollection({
      collectionId: targetCollection._id,
      action: "add",
      entry: {
        cardId: card.id,
        quantity: 1
      }
    });
  };

  // === CONTAINER STYLING ===

  const containerClass = maxHeight
    ? "rounded-md border overflow-hidden flex flex-col"
    : "h-full rounded-md border overflow-hidden flex flex-col";
  const containerStyle = maxHeight ? { maxHeight } : undefined;

  // === RENDER ===

  return (
    <div
      ref={tableRef}
      style={containerStyle}
      className={containerClass}
      tabIndex={0} // Make container focusable for keyboard navigation
    >
      <Table stickyHeader>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-center">Mana Cost</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-center">Set / Rarity</TableHead>
            <TableHead className="text-center">CMC</TableHead>
            <TableHead className="text-center">P/T</TableHead>
            <TableHead className="text-center">Loyalty</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cards.map((card) => (
            <CardsTableRow
              key={card.id}
              card={card}
              onClick={clickHandler}
              onHoverEnter={() => handleRowEnter(card)}
              onHoverLeave={handleRowLeave}
              onHoverMove={handleRowMove}
              onDragStateChange={setIsAnyRowDragging}
              onAddToCollection={handleAddToCollection}
              isSelected={selectedCard?.id === card.id}
              rowRef={getRowRef(card.id)}
            />
          ))}
        </TableBody>
      </Table>
      {/* Show hover popup only when hovering and not dragging */}
      {hovered && !isAnyRowDragging && <CardPopup card={hovered.card} position={hovered.pos} />}
    </div>
  );
}

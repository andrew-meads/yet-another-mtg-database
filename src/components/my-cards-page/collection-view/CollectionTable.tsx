"use client";

import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious
} from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { CardCollectionWithCards } from "@/types/CardCollection";
import { MtgCard } from "@/types/MtgCard";
import { useState, useRef, useEffect, Fragment, useMemo } from "react";
import CardPopup from "@/components/CardPopup";
import SearchDialog, { SearchFilters, searchPredicate } from "@/components/SearchDialog";
import { useCardSelection } from "@/context/CardSelectionContext";
import { useOpenCollectionsContext } from "@/context/OpenCollectionsContext";
import CollectionTableRow from "@/components/my-cards-page/collection-view/CollectionTableRow";
import { useCollectionDropTarget } from "@/hooks/drag-drop/useCollectionDropTarget";
import { useUpdateCollectionCards } from "@/hooks/react-query/useUpdateCollectionCards";

/**
 * Props for the CollectionTable component
 */
export interface CollectionTableProps {
  /** Collection with detailed card information */
  collection: CardCollectionWithCards;
  /** Optional maximum height for the table container */
  maxHeight?: string;
  /** Number of entries per page (enables pagination if set) */
  entriesPerPage?: number;
}

/**
 * Table component for displaying cards in a collection
 *
 * Similar to CardsTable but includes a Quantity column showing
 * how many copies of each card are in the collection.
 */
export default function CollectionTable({
  collection,
  maxHeight,
  entriesPerPage
}: CollectionTableProps) {
  // === STATE MANAGEMENT ===

  // Hover preview popup: tracks which card is being hovered and mouse position
  const [hovered, setHovered] = useState<{ card: MtgCard; pos: { x: number; y: number } } | null>(
    null
  );

  // Track if any row is currently being dragged (to hide hover popup)
  const [isAnyRowDragging, setIsAnyRowDragging] = useState(false);

  // Track selected collection row by row index
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  // Track expanded collection row by row index
  const [expandedRowIndex, setExpandedRowIndex] = useState<number | null>(null);

  // Track where to show the drop indicator when reordering
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);

  // Track search dialog open state
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);

  // Track active search filters (null = no search active)
  const [searchFilters, setSearchFilters] = useState<SearchFilters | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // === CONTEXT ===
  const { activeCollection, openCollections } = useOpenCollectionsContext();

  // === HOOKS ===
  const { mutate: updateCardsInCollection } = useUpdateCollectionCards();

  // === REFS ===
  const tableRef = useRef<HTMLDivElement>(null);

  // === SEARCH FILTERING ===

  // Apply search filters if active
  const filteredEntries = useMemo(() => {
    if (!searchFilters) return collection.cardsDetailed;
    return collection.cardsDetailed.filter(searchPredicate(searchFilters));
  }, [searchFilters, collection.cardsDetailed]);

  // === PAGINATION LOGIC ===

  const totalEntries = filteredEntries?.length || 0;
  const isPaginationEnabled = entriesPerPage !== undefined && entriesPerPage > 0;
  const totalPages = isPaginationEnabled ? Math.ceil(totalEntries / entriesPerPage) : 1;

  // Calculate visible entries based on pagination
  const visibleEntries = isPaginationEnabled
    ? filteredEntries.slice((currentPage - 1) * entriesPerPage!, currentPage * entriesPerPage!)
    : filteredEntries;

  // Reset to page 1 if current page exceeds total pages
  useEffect(() => {
    if (isPaginationEnabled && currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages, isPaginationEnabled]);

  // Card selection context
  const { setSelectedCard } = useCardSelection();

  // Make this component a drop target for cards and card entries.
  const { dropRef, isOver, hoverPosition, hoverPayload } = useCollectionDropTarget({
    collection,
    allowDrop: searchFilters === null, // Disable dropping when search is active
    getDestinationIndex: () => dropIndicatorIndex ?? collection.cardsDetailed.length
  });

  // When dragging something from this collection to itself enable reordering.
  useEffect(() => {
    // Check if we're hovering and the source is this collection
    if (isOver && hoverPayload?.sourceCollectionId === collection._id && hoverPosition) {
      // Find which row we're hovering over based on Y position
      const tableBody = document.querySelector(`[data-collection-id="${collection._id}"] tbody`);
      if (!tableBody) {
        setDropIndicatorIndex(null);
        return;
      }

      // Only select actual data rows, not divider rows
      const rows = Array.from(tableBody.querySelectorAll("tr[data-row-index]"));
      // console.log(rows);

      // Default to end of visible entries
      let targetIndex = isPaginationEnabled
        ? (currentPage - 1) * entriesPerPage + rows.length
        : rows.length;

      // console.log(`Number of rows: ${rows.length}`);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rect = row.getBoundingClientRect();
        // console.log(`Row ${i} rect:`, rect);
        const rowMiddle = rect.top + rect.height / 2;

        if (hoverPosition.y < rowMiddle) {
          // Convert visible index to actual collection index
          targetIndex = isPaginationEnabled ? (currentPage - 1) * entriesPerPage + i : i;
          // console.log("Setting drop indicator to index:", targetIndex);
          break;
        }
      }

      setDropIndicatorIndex(targetIndex);
    } else {
      setDropIndicatorIndex(null);
    }
  }, [
    isOver,
    hoverPosition,
    hoverPayload,
    collection._id,
    isPaginationEnabled,
    currentPage,
    entriesPerPage
  ]);

  // === REFS ===

  // Track last mouse position for hover popup positioning
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Timer for delayed hover popup display (500ms)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
   * Keyboard handler for moving card to active collection
   * Triggered with + or = keys when a row is selected
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only trigger if table is in focus and a row is selected
      if (!tableRef.current?.contains(document.activeElement) || selectedRowIndex === null) {
        return;
      }

      // Check for + or = keys
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        const selectedEntry = filteredEntries[selectedRowIndex];
        if (selectedEntry) {
          handleMoveToCollection(selectedEntry, selectedRowIndex, 1, undefined);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedRowIndex, filteredEntries, activeCollection, openCollections, collection._id]);

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
   * Handle row click to select a collection row
   */
  const handleRowClick = (card: MtgCard, rowIndex: number) => {
    setSelectedRowIndex(rowIndex);
    setSelectedCard(card);
  };

  /**
   * Handle row expand toggle
   */
  const handleRowExpand = (rowIndex: number) => {
    setExpandedRowIndex(expandedRowIndex === rowIndex ? null : rowIndex);
  };

  /**
   * Handle search dialog submission
   */
  const handleSearch = (filters: SearchFilters) => {
    setSearchFilters(filters);
  };

  /**
   * Clear active search filters
   */
  const handleClearSearch = () => {
    setSearchFilters(null);
  };

  /**
   * Handle move to collection
   */
  const handleMoveToCollection = (
    entry: import("@/types/CardCollection").DetailedCardEntry,
    rowIndex: number,
    quantity: number,
    targetCollectionId?: string
  ) => {
    // Determine target collection
    let targetCollection;

    if (targetCollectionId === undefined) {
      // Use active collection if no specific collection ID provided
      if (activeCollection?._id === collection._id) {
        // Can't move to the same collection
        return;
      }
      targetCollection = activeCollection;
    } else {
      // Find collection in open collections by ID
      targetCollection = openCollections.find((c) => c._id === targetCollectionId);
    }

    // Return early if no valid collection found
    if (!targetCollection) return;

    // Remove from current collection
    updateCardsInCollection(
      {
        collectionId: collection._id,
        action: "remove",
        fromIndex: rowIndex,
        quantity
      },
      {
        onSuccess: () => {
          // After successful removal, add to target collection
          updateCardsInCollection({
            collectionId: targetCollection._id,
            action: "add",
            entry: {
              cardId: entry.card.id,
              quantity,
              notes: entry.notes,
              tags: entry.tags
            }
          });
        }
      }
    );
  };

  // === EARLY RETURNS FOR SPECIAL STATES ===

  if (!collection.cardsDetailed || collection.cardsDetailed.length === 0) {
    return (
      <div className="rounded-md border bg-muted/50 p-8 text-center text-muted-foreground">
        No cards in this collection
      </div>
    );
  }

  // === RENDER ===

  return (
    <div
      className="h-full rounded-md border overflow-hidden flex flex-col"
      ref={(node) => {
        if (typeof dropRef === "function") {
          dropRef(node);
        }
        tableRef.current = node;
      }}
      data-collection-id={collection._id}
      tabIndex={0} // Make container focusable for keyboard navigation
    >
      {/* Search and Pagination Controls */}
      <div className="border-b p-3 flex justify-between items-center gap-2 bg-background">
        {/* Pagination Controls */}
        {isPaginationEnabled && totalPages > 1 ? (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className={
                    currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"
                  }
                />
              </PaginationItem>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <PaginationItem key={page}>
                  <PaginationLink
                    onClick={() => setCurrentPage(page)}
                    isActive={currentPage === page}
                    className="cursor-pointer"
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className={
                    currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : (
          <div />
        )}

        {/* Search Buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSearchDialogOpen(true)}
            className="gap-2"
          >
            <Search className="h-4 w-4" />
            Search
          </Button>
          {searchFilters && (
            <Button variant="outline" size="sm" onClick={handleClearSearch} className="gap-2">
              <X className="h-4 w-4" />
              Clear Search
            </Button>
          )}
        </div>
      </div>

      {/* Search Dialog */}
      <SearchDialog
        open={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
        onSearch={handleSearch}
      />

      <Table stickyHeader>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-center">Mana Cost</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-center">Set / Rarity</TableHead>
            <TableHead className="text-center">CMC</TableHead>
            <TableHead className="text-center">P/T</TableHead>
            <TableHead className="text-center">Loyalty</TableHead>
            <TableHead className="text-center">Quantity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleEntries.map((cardDetail, visibleIndex) => {
            // Calculate the actual index in the full collection
            const actualIndex = isPaginationEnabled
              ? (currentPage - 1) * entriesPerPage + visibleIndex
              : visibleIndex;
            return (
              <Fragment key={cardDetail._id}>
                {/* Show drop indicator before this row if needed */}
                {dropIndicatorIndex === actualIndex && (
                  <tr>
                    <td colSpan={9} className="p-0">
                      <div className="h-1 bg-primary" />
                    </td>
                  </tr>
                )}
                <CollectionTableRow
                  collectionId={collection._id}
                  entry={cardDetail}
                  rowIndex={actualIndex}
                  onClick={(card) => handleRowClick(card, actualIndex)}
                  isSelected={selectedRowIndex === actualIndex}
                  isExpanded={expandedRowIndex === actualIndex}
                  onExpand={() => handleRowExpand(actualIndex)}
                  isSearchActive={searchFilters !== null}
                  onHoverEnter={() => handleRowEnter(cardDetail.card)}
                  onHoverLeave={handleRowLeave}
                  onHoverMove={handleRowMove}
                  onDragStateChange={setIsAnyRowDragging}
                  onMoveToCollection={handleMoveToCollection}
                />
              </Fragment>
            );
          })}
          {/* Show drop indicator at the end if needed */}
          {dropIndicatorIndex !== null &&
            dropIndicatorIndex ===
              (isPaginationEnabled
                ? (currentPage - 1) * entriesPerPage! + visibleEntries.length
                : collection.cardsDetailed.length) && (
              <tr>
                <td colSpan={9} className="p-0">
                  <div className="h-1 bg-primary" />
                </td>
              </tr>
            )}
        </TableBody>
      </Table>
      {/* Show hover popup only when hovering and not dragging */}
      {hovered && !isAnyRowDragging && <CardPopup card={hovered.card} position={hovered.pos} />}
    </div>
  );
}

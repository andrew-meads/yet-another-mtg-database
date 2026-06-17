"use client";

import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { CollectionWithCards } from "@/types/Collection";
import { MtgCard } from "@/types/MtgCard";
import { useState, useRef, useEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import CardPopup from "@/components/CardPopup";
import SearchDialog, { SearchFilters, searchPredicate } from "@/components/SearchDialog";
import { useCardSelection } from "@/context/CardSelectionContext";
import CollectionTableRow from "@/components/my-cards-page/collection-view/CollectionTableRow";
import { useCollectionDropTarget } from "@/hooks/drag-drop/useCollectionDropTarget";
import {
  COLLECTION_GRID,
  groupCollectionCards,
  sortGroupRows
} from "@/components/my-cards-page/collection-view/grouping";
import { cn } from "@/lib/utils";

export interface CollectionTableProps {
  collection: CollectionWithCards;
}

/**
 * Virtualized table for a collection. Rows are grouped by card + notes + tags +
 * deck membership (loose copies before deck copies for the same card) and shown
 * with a quantity and a deck badge. No pagination — rows are virtualized.
 */
export default function CollectionTable({ collection }: CollectionTableProps) {
  const [hovered, setHovered] = useState<{ card: MtgCard; pos: { x: number; y: number } } | null>(
    null
  );
  const [isAnyRowDragging, setIsAnyRowDragging] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const [searchFilters, setSearchFilters] = useState<SearchFilters | null>(null);

  const { setSelectedCard } = useCardSelection();

  const rows = useMemo(() => {
    const grouped = groupCollectionCards(collection.cards ?? []);
    const filtered = searchFilters
      ? grouped.filter((r) => searchPredicate(searchFilters)(r.card))
      : grouped;
    return sortGroupRows(filtered);
  }, [collection.cards, searchFilters]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { dropRef, isOver } = useCollectionDropTarget(collection._id, searchFilters === null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 8,
    getItemKey: (index) => rows[index].key
  });

  // Hover popup management
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isAnyRowDragging) {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      setHovered(null);
    }
  }, [isAnyRowDragging]);

  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, []);

  const handleRowEnter = (card: MtgCard) => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = setTimeout(() => {
      setHovered({ card, pos: lastMousePosRef.current });
    }, 500);
  };

  const handleRowLeave = () => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
    setHovered(null);
  };

  const handleRowMove = (e: React.MouseEvent<HTMLDivElement>) => {
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const setScrollAndDropRef = (node: HTMLDivElement | null) => {
    scrollRef.current = node;
    if (typeof dropRef === "function") dropRef(node);
  };

  const isEmpty = !collection.cards || collection.cards.length === 0;

  return (
    <div className="h-full rounded-md border overflow-hidden flex flex-col">
      {/* Controls */}
      <div className="border-b p-3 flex justify-between items-center gap-2 bg-background">
        <div className="text-sm text-muted-foreground">
          {rows.reduce((sum, r) => sum + r.quantity, 0)} cards
        </div>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchFilters(null)}
              className="gap-2"
            >
              <X className="h-4 w-4" />
              Clear Search
            </Button>
          )}
        </div>
      </div>

      <SearchDialog
        open={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
        onSearch={setSearchFilters}
      />

      {/* Header */}
      <div
        className="grid items-center gap-2 px-2 py-2 border-b bg-muted/40 text-xs font-medium text-muted-foreground uppercase"
        style={{ gridTemplateColumns: COLLECTION_GRID }}
      >
        <span />
        <span>Name</span>
        <span className="text-center">Mana</span>
        <span>Type</span>
        <span className="text-center">Set</span>
        <span className="text-center">CMC</span>
        <span className="text-center">P/T</span>
        <span className="text-center">Deck</span>
        <span className="text-right pr-1">Quantity</span>
      </div>

      {/* Virtualized rows */}
      <div
        ref={setScrollAndDropRef}
        className={cn("flex-1 overflow-auto", isOver && "bg-primary/5")}
      >
        {isEmpty ? (
          <div className="p-8 text-center text-muted-foreground">No cards in this collection</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No cards match your search</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <CollectionTableRow
                    collectionId={collection._id}
                    row={row}
                    onClick={(card) => {
                      setSelectedKey(row.key);
                      setSelectedCard(card);
                    }}
                    isSelected={selectedKey === row.key}
                    isExpanded={expandedKey === row.key}
                    onExpand={() => setExpandedKey(expandedKey === row.key ? null : row.key)}
                    isSearchActive={searchFilters !== null}
                    onHoverEnter={() => handleRowEnter(row.card)}
                    onHoverLeave={handleRowLeave}
                    onHoverMove={handleRowMove}
                    onDragStateChange={setIsAnyRowDragging}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hovered && !isAnyRowDragging && <CardPopup card={hovered.card} position={hovered.pos} />}
    </div>
  );
}

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
  const { dropRef, isOver } = useCollectionDropTarget(collection._id);

  // The React Compiler intentionally skips memoizing the value returned by TanStack
  // Virtual's useVirtualizer (it returns non-memoizable functions).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 8,
    getItemKey: (index) => rows[index].key
  });

  // Keep a stable ref to the virtualizer so the keyboard effect doesn't re-run when
  // virtualizer changes identity (TanStack Virtual is not memoized by the React Compiler).
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  // Keyboard navigation — arrow up/down to move through rows.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!scrollRef.current?.contains(document.activeElement)) return;
      // Don't hijack keys when an input inside a row has focus.
      const tag = (document.activeElement as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();

      const currentIndex = selectedKey ? rows.findIndex((r) => r.key === selectedKey) : -1;
      const nextIndex =
        e.key === "ArrowDown"
          ? currentIndex === -1
            ? 0
            : Math.min(currentIndex + 1, rows.length - 1)
          : currentIndex === -1
            ? 0
            : Math.max(currentIndex - 1, 0);

      if (nextIndex !== currentIndex && rows[nextIndex]) {
        const nextRow = rows[nextIndex];
        setSelectedKey(nextRow.key);
        setSelectedCard(nextRow.card);
        virtualizerRef.current.scrollToIndex(nextIndex, { align: "auto" });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedKey, rows, setSelectedCard]);

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
    <div className="flex h-full flex-col overflow-hidden rounded-md border">
      {/* Controls */}
      <div className="bg-background flex items-center justify-between gap-2 border-b p-3">
        <div className="text-muted-foreground text-sm">
          {rows.reduce((sum, r) => sum + r.quantity, 0)} cards
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSearchDialogOpen(true)}
            className="gap-2"
          >
            <Search className="size-4" />
            Search
          </Button>
          {searchFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchFilters(null)}
              className="gap-2"
            >
              <X className="size-4" />
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
        className="bg-muted/40 text-muted-foreground grid items-center gap-2 border-b p-2 text-xs font-medium uppercase"
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
        <span className="pr-1 text-right">Quantity</span>
      </div>

      {/* Virtualized rows */}
      <div
        ref={setScrollAndDropRef}
        className={cn("flex-1 overflow-auto", isOver && "bg-primary/5")}
        tabIndex={0}
      >
        {isEmpty ? (
          <div className="text-muted-foreground p-8 text-center">No cards in this collection</div>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center">No cards match your search</div>
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
                    collectionName={collection.name}
                    row={row}
                    onClick={(card) => {
                      setSelectedKey(row.key);
                      setSelectedCard(card);
                    }}
                    isSelected={selectedKey === row.key}
                    isExpanded={expandedKey === row.key}
                    onExpand={() => setExpandedKey(expandedKey === row.key ? null : row.key)}
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

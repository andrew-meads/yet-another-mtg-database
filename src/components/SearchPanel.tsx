"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import SearchControls, { type SearchControlsValues } from "@/components/SearchControls";
import CardsTable from "@/components/CardsTable";
import { useCardsSearch } from "@/hooks/useCardsSearch";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ICard } from "@/types/ICard";

export default function SearchPanel({ onCardClicked }: { onCardClicked?: (card: ICard) => void }) {
  const [searchParams, setSearchParams] = useState<SearchControlsValues>({
    q: "lang:en exclude:extras",
    order: "name",
    dir: "asc",
    pageLen: 25
  });
  const [page, setPage] = useState(1);
  const scrollPositionRef = useRef<number | null>(null);
  const shouldRestoreScrollRef = useRef(false);

  const { data, isLoading, error } = useCardsSearch({
    q: searchParams.q,
    order: searchParams.order,
    dir: searchParams.dir,
    pageLen: searchParams.pageLen,
    page
  });

  // Restore scroll position after data loads
  useEffect(() => {
    if (!isLoading && shouldRestoreScrollRef.current && scrollPositionRef.current !== null) {
      window.scrollTo(0, scrollPositionRef.current);
      shouldRestoreScrollRef.current = false;
      scrollPositionRef.current = null;
    }
  }, [isLoading, data]);

  const handleSearchChange = useCallback((values: SearchControlsValues) => {
    setSearchParams(values);
    // Reset to page 1 when search params change
    setPage(1);
  }, []);

  const handlePrevPage = () => {
    scrollPositionRef.current = window.scrollY;
    shouldRestoreScrollRef.current = true;
    setPage((p) => Math.max(1, p - 1));
  };

  const handleNextPage = () => {
    if (data?.pagination.hasMore) {
      scrollPositionRef.current = window.scrollY;
      shouldRestoreScrollRef.current = true;
      setPage((p) => p + 1);
    }
  };

  const renderPaginationControls = (position: "top" | "bottom") => {
    if (!data || data.cards.length === 0) return null;

    return (
      <div className="flex items-center justify-between border-t pt-4">
        <div className="text-sm text-muted-foreground">
          Page {data.pagination.page} of {data.pagination.totalPages} • {data.pagination.total}{" "}
          total cards
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePrevPage} disabled={page === 1}>
            <ChevronLeft className="size-4 mr-1" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNextPage}
            disabled={!data.pagination.hasMore}
          >
            Next
            <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <SearchControls onChange={handleSearchChange} initial={searchParams} />

      {/* Pagination controls - Top */}
      {renderPaginationControls("top")}

      <CardsTable
        cards={data?.cards ?? []}
        isLoading={isLoading}
        error={error}
        maxHeight="300px"
        onCardClicked={onCardClicked}
      />

      {/* Pagination controls - Bottom */}
      {renderPaginationControls("bottom")}
    </div>
  );
}

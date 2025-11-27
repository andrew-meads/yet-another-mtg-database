"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import SearchControls, { type SearchControlsValues } from "@/components/SearchControls";
import CardsTable from "@/components/card-search-page/CardsTable";
import { useCardsSearch } from "@/hooks/react-query/useCardsSearch";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationLink,
  PaginationEllipsis
} from "@/components/ui/pagination";
import { useLocalStorage } from "@/hooks/useLocalStorage";

interface SearchPanelProps {
  compact?: boolean;
}

export default function SearchPanel({ compact }: SearchPanelProps) {
  const [searchParams, setSearchParams] = useLocalStorage<SearchControlsValues>(
    "search-panel-params",
    {
      q: "lang:en exclude:extras",
      order: "name",
      dir: "asc",
      pageLen: 25
    }
  );
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

  const handlePageClick = (pageNum: number) => {
    scrollPositionRef.current = window.scrollY;
    shouldRestoreScrollRef.current = true;
    setPage(pageNum);
  };

  const renderPaginationControls = (position: "top" | "bottom") => {
    if (!data || data.cards.length === 0) return null;

    const currentPage = data.pagination.page;
    const totalPages = data.pagination.totalPages;

    // Calculate which page numbers to show
    const getPageNumbers = () => {
      const pages: (number | "ellipsis")[] = [];
      const maxVisible = 7; // Max page numbers to show including ellipsis

      if (totalPages <= maxVisible) {
        // Show all pages if we have few enough
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Always show first page
        pages.push(1);

        // Calculate range around current page
        let startPage = Math.max(2, currentPage - 1);
        let endPage = Math.min(totalPages - 1, currentPage + 1);

        // Add ellipsis after first page if needed
        if (startPage > 2) {
          pages.push("ellipsis");
          startPage = Math.max(startPage, currentPage - 1);
        }

        // Add middle pages
        for (let i = startPage; i <= endPage; i++) {
          pages.push(i);
        }

        // Add ellipsis before last page if needed
        if (endPage < totalPages - 1) {
          pages.push("ellipsis");
        }

        // Always show last page
        pages.push(totalPages);
      }

      return pages;
    };

    const pageNumbers = getPageNumbers();

    return (
      <div className="flex items-center justify-between border-t pt-4 gap-4">
        <p className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
          Page {currentPage} of {totalPages} • {data.pagination.total} total cards
        </p>
        <Pagination key={`pages-${totalPages}`} className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (page > 1) handlePrevPage();
                }}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>

            {pageNumbers.map((pageNum, idx) =>
              pageNum === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${idx}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={pageNum}>
                  <PaginationLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      handlePageClick(pageNum);
                    }}
                    isActive={pageNum === currentPage}
                  >
                    {pageNum}
                  </PaginationLink>
                </PaginationItem>
              )
            )}

            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (data.pagination.hasMore) handleNextPage();
                }}
                aria-disabled={!data.pagination.hasMore}
                className={!data.pagination.hasMore ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <SearchControls compact={compact} onChange={handleSearchChange} initial={searchParams} />

      {/* Pagination controls - Top */}
      {renderPaginationControls("top")}

      <div className="flex-1 min-h-0">
        <CardsTable cards={data?.cards ?? []} isLoading={isLoading} error={error} />
      </div>

      {/* Pagination controls - Bottom */}
      {!compact && renderPaginationControls("bottom")}
    </div>
  );
}

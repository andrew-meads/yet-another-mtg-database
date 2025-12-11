"use client";

import {
  useCallback,
  useRef,
  useEffect,
  useState,
  createContext,
  useContext,
  useMemo
} from "react";
import type { SearchControlsValues } from "@/components/card-search-page/SearchControls";
import { useCardsSearch } from "@/hooks/react-query/useCardsSearch";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationLink,
  PaginationEllipsis
} from "@/components/ui/pagination";

/**
 * Context value for SearchResults
 */
interface SearchResultsContextValue {
  /** Array of cards from the search results */
  cards: any[];
  /** Whether the search is currently loading */
  isLoading: boolean;
  /** Error object if the search failed */
  error: Error | null;
  /** Current page number */
  page: number;
  /** Search parameters */
  searchParams: SearchControlsValues;
  /** Pagination data */
  pagination: {
    page: number;
    totalPages: number;
    total: number;
    hasMore: boolean;
  } | null;
  /** Function to update search parameters */
  onSearchChange: (values: SearchControlsValues) => void;
  /** Function to go to previous page */
  onPrevPage: () => void;
  /** Function to go to next page */
  onNextPage: () => void;
  /** Function to go to specific page */
  onPageClick: (page: number) => void;
}

const SearchResultsContext = createContext<SearchResultsContextValue | null>(null);

/**
 * Hook to access SearchResults context
 */
export function useSearchResults() {
  const context = useContext(SearchResultsContext);
  if (!context) {
    throw new Error("useSearchResults must be used within SearchResults provider");
  }
  return context;
}

/**
 * Props for the SearchResults component
 */
export interface SearchResultsProps {
  /** Child components that can access search results via context */
  children: React.ReactNode;
}

/**
 * SearchResults Component
 *
 * Provides search state and logic via context, including:
 * - Search parameters (query, sort order, page length, etc.)
 * - Pagination state and controls
 * - Scroll position preservation across page changes
 * - Data fetching via useCardsSearch hook
 *
 * Use the useSearchResults hook to access the context in child components.
 * Use SearchResults.PaginationControls to render pagination controls anywhere.
 */
export default function SearchResults({ children }: SearchResultsProps) {
  const [searchParams, setSearchParams] = useLocalStorage<SearchControlsValues>(
    "search-panel-params",
    {
      q: "lang:en exclude:extras",
      order: "name",
      dir: "asc",
      pageLen: 25,
      owned: false
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
    owned: searchParams.owned,
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

  const handleSearchChange = useCallback(
    (values: SearchControlsValues) => {
      setSearchParams(values);
      // Reset to page 1 when search params change
      setPage(1);
    },
    [] // Remove setSearchParams from dependencies - it's stable from useLocalStorage
  );

  const handlePrevPage = useCallback(() => {
    scrollPositionRef.current = window.scrollY;
    shouldRestoreScrollRef.current = true;
    setPage((p) => Math.max(1, p - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    if (data?.pagination.hasMore) {
      scrollPositionRef.current = window.scrollY;
      shouldRestoreScrollRef.current = true;
      setPage((p) => p + 1);
    }
  }, [data?.pagination.hasMore]);

  const handlePageClick = useCallback((pageNum: number) => {
    scrollPositionRef.current = window.scrollY;
    shouldRestoreScrollRef.current = true;
    setPage(pageNum);
  }, []);

  const contextValue: SearchResultsContextValue = useMemo(
    () => ({
      cards: data?.cards ?? [],
      isLoading,
      error: error ?? null,
      page,
      searchParams,
      pagination: data?.pagination ?? null,
      onSearchChange: handleSearchChange,
      onPrevPage: handlePrevPage,
      onNextPage: handleNextPage,
      onPageClick: handlePageClick
    }),
    [
      data?.cards,
      data?.pagination,
      isLoading,
      error,
      page,
      searchParams,
      handleSearchChange,
      handlePrevPage,
      handleNextPage,
      handlePageClick
    ]
  );

  return (
    <SearchResultsContext.Provider value={contextValue}>{children}</SearchResultsContext.Provider>
  );
}

/**
 * PaginationControls Component
 *
 * Renders pagination controls for SearchResults.
 * Must be used within a SearchResults provider.
 */
function PaginationControls() {
  const { page, pagination, onPrevPage, onNextPage, onPageClick } = useSearchResults();

  if (!pagination || pagination.total === 0) return null;

  const currentPage = pagination.page;
  const totalPages = pagination.totalPages;

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
    <div className="flex flex-col sm:flex-row items-center sm:justify-between border-t pt-2 sm:pt-4 gap-2 sm:gap-4">
      <p className="text-sm text-muted-foreground text-center sm:text-left">
        Page {currentPage} of {totalPages} • {pagination.total} total cards
      </p>
      <Pagination key={`pages-${totalPages}`} className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (page > 1) onPrevPage();
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
                    onPageClick(pageNum);
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
                if (pagination.hasMore) onNextPage();
              }}
              aria-disabled={!pagination.hasMore}
              className={!pagination.hasMore ? "pointer-events-none opacity-50" : undefined}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

// Attach PaginationControls as a property of SearchResults
SearchResults.PaginationControls = PaginationControls;

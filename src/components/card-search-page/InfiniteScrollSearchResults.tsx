"use client";

import { useCallback, createContext, useContext, useMemo } from "react";
import type { SearchControlsValues } from "@/components/card-search-page/SearchControls";
import { useInfiniteCardsSearch } from "@/hooks/react-query/useInfiniteCardsSearch";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { MtgCard } from "@/types/MtgCard";

/**
 * Context value for InfiniteScrollSearchResults
 */
interface InfiniteScrollSearchResultsContextValue {
  /** 2D array of all cards from all pages */
  cardPages: MtgCard[][];
  /** Whether the initial search is loading */
  isLoading: boolean;
  /** Error object if the search failed */
  error: Error | null;
  /** Search parameters */
  searchParams: SearchControlsValues;
  /** Whether there are more pages to load */
  hasNextPage: boolean;
  /** Whether next page is currently being fetched */
  isFetchingNextPage: boolean;
  /** Function to fetch the next page */
  fetchNextPage: () => void;
  /** Function to update search parameters */
  onSearchChange: (values: SearchControlsValues) => void;
}

const InfiniteScrollSearchResultsContext =
  createContext<InfiniteScrollSearchResultsContextValue | null>(null);

/**
 * Hook to access InfiniteScrollSearchResults context
 */
export function useInfiniteScrollSearchResults() {
  const context = useContext(InfiniteScrollSearchResultsContext);
  if (!context) {
    throw new Error(
      "useInfiniteScrollSearchResults must be used within InfiniteScrollSearchResults provider"
    );
  }
  return context;
}

/**
 * Props for the InfiniteScrollSearchResults component
 */
export interface InfiniteScrollSearchResultsProps {
  /** Child components that can access search results via context */
  children: React.ReactNode;
}

const DEFAULT_FILTERS = "lang:en exclude:extras";

/**
 * InfiniteScrollSearchResults Component
 *
 * Provides infinite scroll search state and logic via context, including:
 * - Search parameters (query, sort order, page length, etc.)
 * - Infinite scroll state (hasNextPage, fetchNextPage)
 * - Data fetching via useInfiniteCardsSearch hook
 * - Flattened array of all loaded cards
 *
 * Use the useInfiniteScrollSearchResults hook to access the context in child components.
 * Designed for mobile views with infinite scrolling instead of pagination.
 */
export default function InfiniteScrollSearchResults({
  children
}: InfiniteScrollSearchResultsProps) {
  const [searchParams, setSearchParams] = useLocalStorage<SearchControlsValues>(
    "search-panel-params",
    {
      q: "",
      order: "name",
      dir: "asc",
      pageLen: 25,
      owned: false,
      useDefaultFilters: true
    }
  );

  const q = searchParams.useDefaultFilters
    ? `${DEFAULT_FILTERS} ${searchParams.q}`.trim()
    : searchParams.q;

  const queryResult = useInfiniteCardsSearch({
    q,
    order: searchParams.order,
    dir: searchParams.dir,
    pageLen: searchParams.pageLen,
    owned: searchParams.owned
  });

  const { data, isLoading, error, hasNextPage, isFetchingNextPage, fetchNextPage } = queryResult;

  const handleSearchChange = useCallback(
    (values: SearchControlsValues) => {
      setSearchParams(values);
      // When search params change, the query key changes and React Query automatically
      // resets to page 1 and clears previous pages
    },
    [] // setSearchParams is stable from useLocalStorage
  );

  // Flatten all pages into a single cards array
  const cardPages = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.map((page) => page.cards);
  }, [data]);

  const contextValue: InfiniteScrollSearchResultsContextValue = useMemo(
    () => ({
      cardPages,
      isLoading,
      error: error ?? null,
      searchParams,
      hasNextPage: hasNextPage ?? false,
      isFetchingNextPage,
      fetchNextPage,
      onSearchChange: handleSearchChange
    }),
    [
      cardPages,
      isLoading,
      error,
      searchParams,
      hasNextPage,
      isFetchingNextPage,
      fetchNextPage,
      handleSearchChange
    ]
  );

  return (
    <InfiniteScrollSearchResultsContext.Provider value={contextValue}>
      {children}
    </InfiniteScrollSearchResultsContext.Provider>
  );
}

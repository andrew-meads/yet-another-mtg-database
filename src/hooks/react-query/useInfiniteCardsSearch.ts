"use client";

import { useMemo } from "react";
import { useInfiniteQuery, UseInfiniteQueryOptions, InfiniteData } from "@tanstack/react-query";
import { MtgCard } from "@/types/MtgCard";

/**
 * Response shape from GET /api/cards (single page)
 */
export interface CardsPageResponse {
  cards: MtgCard[];
  query: string | null;
  pagination: {
    total: number;
    page: number;
    pageLen: number;
    totalPages: number;
    hasMore: boolean;
  };
  sort: {
    order: string;
    dir: "asc" | "desc";
  };
  error?: string;
}

/**
 * Query parameters for infinite cards search
 */
export type InfiniteCardsQueryParams = {
  /** Search query string (Scryfall syntax) */
  q?: string | null;
  /** Number of cards per page */
  pageLen?: number;
  /** Sort field (e.g., "name", "cmc", "released") */
  order?: string;
  /** Sort direction */
  dir?: "asc" | "desc";
  /** Filter to only cards the user owns */
  owned?: boolean;
  /** Optional: allow disabling the query from the caller */
  enabled?: boolean;
};

/**
 * Build query string from parameters
 */
function buildQueryString(params: InfiniteCardsQueryParams, page: number): string {
  const sp = new URLSearchParams();
  if (params.q && params.q.trim().length > 0) sp.set("q", params.q.trim());
  if (page > 1) sp.set("page", String(page));
  if (params.pageLen && params.pageLen !== 100) sp.set("page-len", String(params.pageLen));
  if (params.order && params.order !== "name") sp.set("order", params.order);
  if (params.dir && params.dir !== "asc") sp.set("dir", params.dir);
  if (params.owned) sp.set("owned", "true");
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Fetch a single page of cards
 */
async function fetchCardsPage(
  params: InfiniteCardsQueryParams,
  page: number,
  signal?: AbortSignal
): Promise<CardsPageResponse> {
  const qs = buildQueryString(params, page);
  const res = await fetch(`/api/cards${qs}`, { signal, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed with ${res.status}`);
  }
  return res.json();
}

/**
 * Hook for infinite scrolling card search
 *
 * Uses React Query's useInfiniteQuery to fetch paginated card results.
 * Automatically handles fetching next pages when user scrolls.
 *
 * @param params - Search parameters (query, sort, filters, etc.)
 * @param options - Additional React Query options
 * @returns Infinite query result with pages array, fetchNextPage function, etc.
 *
 * @example
 * ```tsx
 * const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteCardsSearch({
 *   q: "type:creature",
 *   order: "name",
 *   pageLen: 25
 * });
 *
 * const allCards = data?.pages.flatMap(page => page.cards) || [];
 * ```
 */
export function useInfiniteCardsSearch(
  params: InfiniteCardsQueryParams,
  options?: Omit<
    UseInfiniteQueryOptions<CardsPageResponse, Error, InfiniteData<CardsPageResponse>, any[], number>,
    "queryKey" | "queryFn" | "getNextPageParam" | "initialPageParam"
  >
) {
  // Normalize params (defaults + clamping) to keep stable query keys
  const normalized = useMemo(() => {
    const pageLen = params.pageLen ?? 25;
    const order = params.order ?? "name";
    const dir: "asc" | "desc" = params.dir ?? "asc";
    const q = params.q?.trim() ?? "";
    const owned = params.owned ?? false;
    return { q, pageLen, order, dir, owned } as Required<Omit<InfiniteCardsQueryParams, "enabled">>;
  }, [params.q, params.pageLen, params.order, params.dir, params.owned]);

  return useInfiniteQuery<CardsPageResponse, Error, InfiniteData<CardsPageResponse>, any[], number>({
    queryKey: [
      "cards-infinite",
      normalized.q,
      normalized.pageLen,
      normalized.order,
      normalized.dir,
      normalized.owned
    ],
    queryFn: ({ pageParam, signal }) => fetchCardsPage(normalized, pageParam, signal),
    getNextPageParam: (lastPage) => {
      // Return next page number if there are more pages, otherwise undefined
      return lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined;
    },
    initialPageParam: 1,
    staleTime: 15_000,
    enabled: params.enabled ?? true,
    ...options
  });
}

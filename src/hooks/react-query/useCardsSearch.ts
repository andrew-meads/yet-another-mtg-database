"use client";

import { useMemo } from "react";
import { useQuery, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { MtgCard } from "@/types/MtgCard";

// Response shape from GET /api/cards
export interface CardsResponse {
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

export type CardsQueryParams = {
  q?: string | null;
  page?: number;
  pageLen?: number;
  order?: string;
  dir?: "asc" | "desc";
  // Optional: allow disabling the query from the caller
  enabled?: boolean;
};

function buildQueryString(params: CardsQueryParams): string {
  const sp = new URLSearchParams();
  if (params.q && params.q.trim().length > 0) sp.set("q", params.q.trim());
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  if (params.pageLen && params.pageLen !== 100) sp.set("page-len", String(params.pageLen));
  if (params.order && params.order !== "name") sp.set("order", params.order);
  if (params.dir && params.dir !== "asc") sp.set("dir", params.dir);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

async function fetchCards(params: CardsQueryParams, signal?: AbortSignal): Promise<CardsResponse> {
  const qs = buildQueryString(params);
  const res = await fetch(`/api/cards${qs}`, { signal, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed with ${res.status}`);
  }
  return res.json();
}

export function useCardsSearch<TData = CardsResponse>(
  params: CardsQueryParams,
  options?: Omit<UseQueryOptions<CardsResponse, Error, TData, any[]>, "queryKey" | "queryFn">
): UseQueryResult<TData, Error> {
  // Normalize params (defaults + clamping) to keep stable query keys
  const normalized = useMemo(() => {
    const page = Math.max(1, params.page ?? 1);
    const pageLen = params.pageLen ?? 100;
    const order = params.order ?? "name";
    const dir: "asc" | "desc" = params.dir ?? "asc";
    const q = params.q?.trim() ?? "";
    return { q, page, pageLen, order, dir } as Required<Omit<CardsQueryParams, "enabled">>;
  }, [params.q, params.page, params.pageLen, params.order, params.dir]);

  return useQuery<CardsResponse, Error, TData, any[]>({
    queryKey: [
      "cards",
      normalized.q,
      normalized.page,
      normalized.pageLen,
      normalized.order,
      normalized.dir
    ],
    queryFn: ({ signal }) => fetchCards(normalized, signal),
    staleTime: 15_000,
    // v5 replacement for keepPreviousData
    placeholderData: (prev) => prev as any,
    enabled: params.enabled ?? true,
    ...options,
  });
}

"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { CollectionSummary } from "@/types/CardCollection";

export interface CollectionSummariesResponse {
  collections: CollectionSummary[];
}

async function fetchCollectionSummaries(): Promise<CollectionSummariesResponse> {
  const res = await fetch("/api/collections/summaries", {
    cache: "no-store"
  });

  if (!res.ok) {
    const errorData = await res
      .json()
      .catch(() => ({ error: "Failed to fetch collection summaries" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

export function useRetrieveCollectionSummaries(): UseQueryResult<
  CollectionSummariesResponse,
  Error
> {
  return useQuery({
    queryKey: ["collection-summaries"],
    queryFn: fetchCollectionSummaries,
    staleTime: 30_000 // Consider data fresh for 30 seconds
  });
}

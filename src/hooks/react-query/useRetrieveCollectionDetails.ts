"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { CollectionWithCards } from "@/types/Collection";

export interface CollectionDetailsResponse {
  collection: CollectionWithCards;
}

async function fetchCollectionDetails(
  collectionId: string,
  q?: string
): Promise<CollectionDetailsResponse> {
  const params = new URLSearchParams({ details: "true" });
  if (q && q.trim().length > 0) params.set("q", q.trim());

  const res = await fetch(`/api/collections/${collectionId}?${params.toString()}`, {
    cache: "no-store"
  });

  if (!res.ok) {
    const errorData = await res
      .json()
      .catch(() => ({ error: "Failed to fetch collection details" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

export function useRetrieveCollectionDetails(
  collectionId: string | null,
  q?: string
): UseQueryResult<CollectionDetailsResponse, Error> {
  return useQuery({
    queryKey: ["collection-details", collectionId, q ?? ""],
    queryFn: () => fetchCollectionDetails(collectionId!, q),
    enabled: !!collectionId, // Only run query if collectionId is provided
    staleTime: 30_000, // Consider data fresh for 30 seconds
    placeholderData: (prev) => prev // Keep showing previous results while refetching on query change
  });
}

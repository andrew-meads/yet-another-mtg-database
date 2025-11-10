"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { CardCollectionWithCards } from "@/types/CardCollection";

export interface CollectionDetailsResponse {
  collection: CardCollectionWithCards;
}

async function fetchCollectionDetails(collectionId: string): Promise<CollectionDetailsResponse> {
  const res = await fetch(`/api/collections/${collectionId}?details=true`, {
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
  collectionId: string | null
): UseQueryResult<CollectionDetailsResponse, Error> {
  return useQuery({
    queryKey: ["collection-details", collectionId],
    queryFn: () => fetchCollectionDetails(collectionId!),
    enabled: !!collectionId, // Only run query if collectionId is provided
    staleTime: 30_000 // Consider data fresh for 30 seconds
  });
}

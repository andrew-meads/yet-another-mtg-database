"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { CollectionWithCardEntries, CollectionWithCards } from "@/types/Collection";
import { CardDataMap } from "@/types/PhysicalCard";
import { joinCardEntries } from "@/lib/cardEntries";

export interface CollectionDetailsResponse {
  collection: CollectionWithCards;
}

/** Wire shape: card data is shipped once in `cardData`, entries reference it by id. */
interface CollectionDetailsWireResponse {
  collection: CollectionWithCardEntries;
  cardData: CardDataMap;
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

  const { collection, cardData }: CollectionDetailsWireResponse = await res.json();
  return {
    collection: { ...collection, cards: joinCardEntries(collection.cards, cardData) }
  };
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

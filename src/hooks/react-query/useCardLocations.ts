"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { CardLocation, CardLocationEntries } from "@/types/CardLocation";
import { CardDataMap } from "@/types/PhysicalCard";
import { joinCardEntries } from "@/lib/cardEntries";

export interface CardLocationsResponse {
  locations: CardLocation[];
}

/** Wire shape: card data is shipped once in `cardData`, entries reference it by id. */
interface CardLocationsWireResponse {
  locations: CardLocationEntries[];
  cardData: CardDataMap;
}

async function fetchCardLocations(cardName: string): Promise<CardLocationsResponse> {
  const params = new URLSearchParams({ name: cardName });
  const res = await fetch(`/api/cards/locations?${params.toString()}`, {
    cache: "no-store"
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to fetch card locations" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  const { locations, cardData }: CardLocationsWireResponse = await res.json();
  return {
    locations: locations.map((location) => ({
      ...location,
      cards: joinCardEntries(location.cards, cardData)
    }))
  };
}

export function useCardLocations(
  cardName: string | null
): UseQueryResult<CardLocationsResponse, Error> {
  return useQuery({
    queryKey: ["card-locations", cardName],
    queryFn: () => fetchCardLocations(cardName!),
    enabled: !!cardName, // Only run query if cardName is provided
    staleTime: 30_000 // Consider data fresh for 30 seconds
  });
}

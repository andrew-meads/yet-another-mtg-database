"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { CardLocation } from "@/types/CardLocation";

export interface CardLocationsResponse {
  locations: CardLocation[];
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

  return res.json();
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

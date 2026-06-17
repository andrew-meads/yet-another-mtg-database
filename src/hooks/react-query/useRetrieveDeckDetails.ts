"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { DeckWithCards } from "@/types/Deck";

export interface DeckDetailsResponse {
  deck: DeckWithCards;
}

async function fetchDeckDetails(deckId: string): Promise<DeckDetailsResponse> {
  const res = await fetch(`/api/decks/${deckId}?details=true`, { cache: "no-store" });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to fetch deck details" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function useRetrieveDeckDetails(
  deckId: string | null
): UseQueryResult<DeckDetailsResponse, Error> {
  return useQuery({
    queryKey: ["deck-details", deckId],
    queryFn: () => fetchDeckDetails(deckId!),
    enabled: !!deckId,
    staleTime: 30_000
  });
}

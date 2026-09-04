"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { DeckWithCardEntries, DeckWithCards } from "@/types/Deck";
import { CardDataMap } from "@/types/PhysicalCard";
import { joinDeckEntries } from "@/lib/cardEntries";
import { ApiError, retryUnlessNotFound } from "@/lib/apiError";

export interface DeckDetailsResponse {
  deck: DeckWithCards;
}

/** Wire shape: card data is shipped once in `cardData`, entries reference it by id. */
interface DeckDetailsWireResponse {
  deck: DeckWithCardEntries;
  cardData: CardDataMap;
}

async function fetchDeckDetails(deckId: string): Promise<DeckDetailsResponse> {
  const res = await fetch(`/api/decks/${deckId}?details=true`, { cache: "no-store" });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to fetch deck details" }));
    throw new ApiError(errorData.error || `Request failed with status ${res.status}`, res.status);
  }
  const { deck, cardData }: DeckDetailsWireResponse = await res.json();

  return { deck: joinDeckEntries(deck, cardData) };
}

export function useRetrieveDeckDetails(
  deckId: string | null
): UseQueryResult<DeckDetailsResponse, Error> {
  return useQuery({
    queryKey: ["deck-details", deckId],
    queryFn: () => fetchDeckDetails(deckId!),
    enabled: !!deckId,
    retry: retryUnlessNotFound,
    staleTime: 30_000
  });
}

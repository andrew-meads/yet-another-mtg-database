"use client";

import { DeckSummary } from "@/types/Deck";
import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";

export interface UpdateActiveDeckRequest {
  deckId: string;
  isActive: boolean;
}

async function updateActiveDeck({
  isActive,
  deckId
}: UpdateActiveDeckRequest): Promise<DeckSummary> {
  const res = await fetch(`/api/decks/${deckId}/isActive`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ isActive })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to update deck" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

/**
 * Hook to update the active status of a deck.
 *
 * When setting a deck to active, all other decks will be automatically deactivated
 * by the API. The active deck is independent of the active collection.
 *
 * @returns Mutation result with mutate function to update active status
 */
export function useUpdateActiveDeck(): UseMutationResult<
  DeckSummary,
  Error,
  UpdateActiveDeckRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateActiveDeck,
    onSuccess: () => {
      // Invalidate deck summaries cache to reflect updated isActive states
      queryClient.invalidateQueries({ queryKey: ["deck-summaries"] });
    }
  });
}

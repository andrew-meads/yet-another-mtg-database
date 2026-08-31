"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "./invalidate";

export interface FillDeckRequest {
  deckId: string;
  swaps: { ephemeralId: string; physicalCardId: string }[];
}

export interface FillDeckResponse {
  ok: boolean;
  filled: number;
}

async function fillDeck({ deckId, ...body }: FillDeckRequest): Promise<FillDeckResponse> {
  const res = await fetch(`/api/decks/${deckId}/fill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to fill deck" }));
    throw new Error(error.error || "Failed to fill deck");
  }
  return res.json();
}

/**
 * Fill a deck's ephemeral placeholders with real collection cards: each swap
 * replaces one ephemeral in place with the given physical card and deletes the
 * ephemeral.
 */
export function useFillDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fillDeck,
    onSuccess: () => invalidateCardMembership(queryClient)
  });
}

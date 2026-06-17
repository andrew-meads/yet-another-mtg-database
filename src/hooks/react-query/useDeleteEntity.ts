"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "./invalidate";

async function del(url: string) {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to delete" }));
    throw new Error(error.error || "Failed to delete");
  }
}

export function useDeleteCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (collectionId: string) => del(`/api/collections/${collectionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection-summaries"] });
      invalidateCardMembership(queryClient);
    }
  });
}

export function useDeleteDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckId: string) => del(`/api/decks/${deckId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deck-summaries"] });
      invalidateCardMembership(queryClient);
    }
  });
}

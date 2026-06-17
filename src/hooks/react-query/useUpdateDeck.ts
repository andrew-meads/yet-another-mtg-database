"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

export interface UpdateDeckRequest {
  deckId: string;
  name?: string;
  description?: string;
}

/**
 * Hook to update a deck's name and/or description (PATCH /api/decks/[id]).
 */
export function useUpdateDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ deckId, name, description }: UpdateDeckRequest) => {
      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (description !== undefined) body.description = description;

      const res = await fetch(`/api/decks/${deckId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to update deck" }));
        throw new Error(error.error || "Failed to update deck");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["deck-details", variables.deckId] });
      queryClient.invalidateQueries({ queryKey: ["deck-summaries"] });
    }
  });
}

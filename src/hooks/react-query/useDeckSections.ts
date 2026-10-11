"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DeckSectionKind } from "@/types/Deck";
import { SectionSortMode } from "@/lib/deckSectionSort";
import { applySectionOrder } from "@/lib/deckUtils";
import { DeckDetailsResponse } from "./useRetrieveDeckDetails";

async function request(deckId: string, method: string, body: unknown) {
  const res = await fetch(`/api/decks/${deckId}/sections`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to update sections" }));
    throw new Error(error.error || "Failed to update sections");
  }
  return res.json();
}

export function useAddSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deckId, name }: { deckId: string; name: string }) =>
      request(deckId, "POST", { name }),
    onSuccess: (_d, v) => queryClient.invalidateQueries({ queryKey: ["deck-details", v.deckId] })
  });
}

export function useUpdateSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deckId,
      sectionId,
      name,
      kind
    }: {
      deckId: string;
      sectionId: string;
      name?: string;
      kind?: DeckSectionKind;
    }) => request(deckId, "PATCH", { sectionId, name, kind }),
    onSuccess: (_d, v) => queryClient.invalidateQueries({ queryKey: ["deck-details", v.deckId] })
  });
}

/**
 * Reorders a deck's sections. `order` must list every section id exactly once. The
 * cached deck is reordered optimistically so a dragged section doesn't snap back while
 * the request is in flight, and restored if the server refuses.
 */
export function useReorderSections() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deckId, order }: { deckId: string; order: string[] }) =>
      request(deckId, "PATCH", { order }),
    onMutate: async ({ deckId, order }) => {
      const queryKey = ["deck-details", deckId];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<DeckDetailsResponse>(queryKey);
      if (previous) {
        queryClient.setQueryData<DeckDetailsResponse>(queryKey, {
          ...previous,
          deck: { ...previous.deck, sections: applySectionOrder(previous.deck.sections, order) }
        });
      }
      return { previous };
    },
    onError: (_e, v, context) => {
      if (context?.previous) queryClient.setQueryData(["deck-details", v.deckId], context.previous);
    },
    onSettled: (_d, _e, v) =>
      queryClient.invalidateQueries({ queryKey: ["deck-details", v.deckId] })
  });
}

export function useDeleteSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deckId, sectionId }: { deckId: string; sectionId: string }) =>
      request(deckId, "DELETE", { sectionId }),
    onSuccess: (_d, v) => queryClient.invalidateQueries({ queryKey: ["deck-details", v.deckId] })
  });
}

export function useSortSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      deckId,
      sectionId,
      mode
    }: {
      deckId: string;
      sectionId: string;
      mode: SectionSortMode;
    }) => {
      const res = await fetch(`/api/decks/${deckId}/sections/sort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, mode })
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to sort section" }));
        throw new Error(error.error || "Failed to sort section");
      }
      return res.json();
    },
    onSuccess: (_d, v) => queryClient.invalidateQueries({ queryKey: ["deck-details", v.deckId] })
  });
}

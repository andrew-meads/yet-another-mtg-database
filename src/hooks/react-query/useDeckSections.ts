"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

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
      order
    }: {
      deckId: string;
      sectionId?: string;
      name?: string;
      order?: string[];
    }) => request(deckId, "PATCH", { sectionId, name, order }),
    onSuccess: (_d, v) => queryClient.invalidateQueries({ queryKey: ["deck-details", v.deckId] })
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

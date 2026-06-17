"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

async function request(deckId: string, method: string, body: unknown) {
  const res = await fetch(`/api/decks/${deckId}/columns`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to update columns" }));
    throw new Error(error.error || "Failed to update columns");
  }
  return res.json();
}

export function useAddColumn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deckId, sectionId }: { deckId: string; sectionId: string }) =>
      request(deckId, "POST", { sectionId }),
    onSuccess: (_d, v) => queryClient.invalidateQueries({ queryKey: ["deck-details", v.deckId] })
  });
}

export function useReorderColumns() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deckId,
      sectionId,
      order
    }: {
      deckId: string;
      sectionId: string;
      order: string[];
    }) => request(deckId, "PATCH", { sectionId, order }),
    onSuccess: (_d, v) => queryClient.invalidateQueries({ queryKey: ["deck-details", v.deckId] })
  });
}

export function useDeleteColumn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deckId,
      sectionId,
      columnId
    }: {
      deckId: string;
      sectionId: string;
      columnId: string;
    }) => request(deckId, "DELETE", { sectionId, columnId }),
    onSuccess: (_d, v) => queryClient.invalidateQueries({ queryKey: ["deck-details", v.deckId] })
  });
}

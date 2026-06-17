"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "./invalidate";

export interface RemoveCardGroupRequest {
  collectionId: string;
  cardId: string;
  notes?: string;
  tags?: string[];
  /** null = the loose (no-deck) group; a value targets that deck's group. */
  deckId?: string | null;
  quantity: number;
}

async function removeCardGroup(body: RemoveCardGroupRequest) {
  const res = await fetch("/api/physical-cards/remove-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to remove cards" }));
    throw new Error(error.error || "Failed to remove cards");
  }
  return res.json();
}

export function useRemoveCardGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeCardGroup,
    onSuccess: () => invalidateCardMembership(queryClient)
  });
}

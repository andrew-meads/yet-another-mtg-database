"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "./invalidate";
import { CardCondition, CardFinish } from "@/lib/cardAttributes";

export interface RemoveCardGroupRequest {
  collectionId: string;
  cardId: string;
  notes?: string;
  tags?: string[];
  /** Effective finish of the group (omit = non-foil). */
  finish?: CardFinish;
  /** Effective condition of the group (omit = NM). */
  condition?: CardCondition;
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

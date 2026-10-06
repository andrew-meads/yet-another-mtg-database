"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "./invalidate";

export interface MovePhysicalCardsRequest {
  physicalCardIds: string[];
  /** Destination collection (deck assignments are kept). */
  collectionId: string;
}

async function movePhysicalCards(body: MovePhysicalCardsRequest) {
  const res = await fetch("/api/physical-cards", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to move cards" }));
    throw new Error(error.error || "Failed to move cards");
  }
  return res.json();
}

/** Move a batch of physical cards to another collection in a single request. */
export function useMovePhysicalCards() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: movePhysicalCards,
    onSuccess: () => invalidateCardMembership(queryClient)
  });
}

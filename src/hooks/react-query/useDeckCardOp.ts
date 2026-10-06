"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "./invalidate";

export interface DeckCardOpRequest {
  deckId: string;
  op: "place" | "move" | "remove";
  /** The copies to act on; placed in this order. One request covers them all. */
  physicalCardIds: string[];
  sectionId?: string;
  columnId?: string;
  index?: number;
}

async function deckCardOp({ deckId, ...body }: DeckCardOpRequest) {
  const res = await fetch(`/api/decks/${deckId}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to update deck card" }));
    throw new Error(error.error || "Failed to update deck card");
  }
  return res.json();
}

/**
 * Place, move, or remove a batch of physical cards within a deck's arrangement, in a
 * single request (so the membership queries are invalidated once per batch).
 */
export function useDeckCardOp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deckCardOp,
    onSuccess: () => invalidateCardMembership(queryClient)
  });
}

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "./invalidate";

export interface CreatePhysicalCardRequest {
  cardId: string;
  collectionId: string;
  notes?: string;
  tags?: string[];
  /** If set, also assign the new card(s) to this deck slot. */
  deckId?: string;
  sectionId?: string;
  columnId?: string;
  index?: number;
  /** Number of copies to create (default 1). */
  quantity?: number;
}

export interface CreatePhysicalCardResponse {
  physicalCardIds: string[];
}

async function createPhysicalCard(
  body: CreatePhysicalCardRequest
): Promise<CreatePhysicalCardResponse> {
  const res = await fetch("/api/physical-cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to add card" }));
    throw new Error(error.error || "Failed to add card");
  }
  return res.json();
}

export function useCreatePhysicalCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPhysicalCard,
    onSuccess: (_data, variables) => {
      invalidateCardMembership(queryClient);
      if (variables.tags?.length) queryClient.invalidateQueries({ queryKey: ["tags"] });
    }
  });
}

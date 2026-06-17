"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "./invalidate";

export interface UpdatePhysicalCardRequest {
  physicalCardId: string;
  notes?: string;
  tags?: string[];
  /** Move the card to a different collection (keeps its deck assignment). */
  collectionId?: string;
}

async function updatePhysicalCard({ physicalCardId, ...body }: UpdatePhysicalCardRequest) {
  const res = await fetch(`/api/physical-cards/${physicalCardId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to update card" }));
    throw new Error(error.error || "Failed to update card");
  }
  return res.json();
}

export function useUpdatePhysicalCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePhysicalCard,
    onSuccess: (_data, variables) => {
      invalidateCardMembership(queryClient);
      if (variables.tags?.length) queryClient.invalidateQueries({ queryKey: ["tags"] });
    }
  });
}

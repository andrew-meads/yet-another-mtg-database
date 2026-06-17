"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "./invalidate";

async function deletePhysicalCard(physicalCardId: string) {
  const res = await fetch(`/api/physical-cards/${physicalCardId}`, { method: "DELETE" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to delete card" }));
    throw new Error(error.error || "Failed to delete card");
  }
}

export function useDeletePhysicalCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePhysicalCard,
    onSuccess: () => invalidateCardMembership(queryClient)
  });
}

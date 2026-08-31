"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "./invalidate";

export interface ArchiveDeckResponse {
  ok: boolean;
  archived: number;
}

async function archiveDeck(deckId: string): Promise<ArchiveDeckResponse> {
  const res = await fetch(`/api/decks/${deckId}/archive`, { method: "POST" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to archive deck" }));
    throw new Error(error.error || "Failed to archive deck");
  }
  return res.json();
}

/**
 * Archive a deck: its collection-backed cards return to their collections and
 * are replaced in place by ephemeral placeholders of the same printings.
 */
export function useArchiveDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveDeck,
    onSuccess: () => invalidateCardMembership(queryClient)
  });
}

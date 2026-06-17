"use client";

import { Deck } from "@/types/Deck";
import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";

export interface CreateDeckRequest {
  name: string;
  description: string;
}

export interface CreateDeckResponse {
  deck: Deck;
}

async function createDeck(data: CreateDeckRequest): Promise<CreateDeckResponse> {
  const res = await fetch("/api/decks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to create deck" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function useCreateDeck(): UseMutationResult<CreateDeckResponse, Error, CreateDeckRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createDeck,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deck-summaries"] });
    }
  });
}

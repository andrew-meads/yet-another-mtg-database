"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { DeckSummary } from "@/types/Deck";
import { useSession } from "next-auth/react";

export interface DeckSummariesResponse {
  decks: DeckSummary[];
}

async function fetchDeckSummaries(): Promise<DeckSummariesResponse> {
  const res = await fetch("/api/decks", { cache: "no-store" });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to fetch deck summaries" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function useRetrieveDeckSummaries(): UseQueryResult<DeckSummariesResponse, Error> {
  const { status } = useSession();
  return useQuery({
    queryKey: ["deck-summaries"],
    queryFn: fetchDeckSummaries,
    staleTime: 30_000,
    enabled: status === "authenticated"
  });
}

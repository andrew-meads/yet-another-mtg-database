"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { MtgCard } from "@/types/MtgCard";

export interface BasicLandsResponse {
  cards: MtgCard[];
}

async function fetchBasicLands(): Promise<BasicLandsResponse> {
  const res = await fetch("/api/cards/basic-lands");
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to fetch basic lands" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

/** The five basic lands used to add ephemeral lands to a deck. Static data. */
export function useBasicLands(): UseQueryResult<BasicLandsResponse, Error> {
  return useQuery({
    queryKey: ["basic-lands"],
    queryFn: fetchBasicLands,
    staleTime: Infinity
  });
}

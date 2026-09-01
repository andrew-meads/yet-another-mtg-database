"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { AiStatusResponse } from "@/types/UserSettings";

async function fetchAiStatus(): Promise<AiStatusResponse> {
  const res = await fetch("/api/ai/status", { cache: "no-store" });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to fetch AI status" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

/**
 * Whether the user has a complete AI configuration. Every AI entry point in the
 * UI gates on this and renders setup guidance when `configured` is false.
 */
export function useAiStatus(): UseQueryResult<AiStatusResponse, Error> {
  const { status } = useSession();

  return useQuery({
    queryKey: ["ai-status"],
    queryFn: fetchAiStatus,
    staleTime: 60_000,
    enabled: status === "authenticated"
  });
}

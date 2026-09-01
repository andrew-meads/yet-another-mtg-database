"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { UserSettingsResponse } from "@/types/UserSettings";

async function fetchUserSettings(): Promise<UserSettingsResponse> {
  const res = await fetch("/api/settings", { cache: "no-store" });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to fetch settings" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

/**
 * The user's server-synced settings (card preview, open entities, masked AI
 * settings). Hydrates SettingsContext / OpenEntitiesContext and the settings
 * page; mutations write back into this cache (key `["user-settings"]`).
 */
export function useUserSettings(): UseQueryResult<UserSettingsResponse, Error> {
  const { status } = useSession();

  return useQuery({
    queryKey: ["user-settings"],
    queryFn: fetchUserSettings,
    staleTime: 60_000,
    enabled: status === "authenticated"
  });
}

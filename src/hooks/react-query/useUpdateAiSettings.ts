"use client";

import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";
import { UserSettingsResponse } from "@/types/UserSettings";

/**
 * `apiKey` semantics: omitted = keep the stored key, "" = clear it, anything
 * else = replace it. The server never echoes the key back.
 */
export interface UpdateAiSettingsRequest {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

async function updateAiSettings(body: UpdateAiSettingsRequest): Promise<UserSettingsResponse> {
  const res = await fetch("/api/settings/ai", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to update AI settings" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

export function useUpdateAiSettings(): UseMutationResult<
  UserSettingsResponse,
  Error,
  UpdateAiSettingsRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateAiSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["user-settings"], data);
      queryClient.invalidateQueries({ queryKey: ["ai-status"] });
    }
  });
}

"use client";

import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";
import { CardPreviewSettings, OpenEntityRef, UserSettingsResponse } from "@/types/UserSettings";

export interface UpdateUserSettingsRequest {
  cardPreview?: CardPreviewSettings;
  openEntities?: OpenEntityRef[];
}

async function updateUserSettings(
  patch: UpdateUserSettingsRequest
): Promise<UserSettingsResponse> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to update settings" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

/**
 * Partial update of the non-secret settings sections. The response is written
 * straight into the `["user-settings"]` cache so later mounts see fresh data
 * without a refetch.
 */
export function useUpdateUserSettings(): UseMutationResult<
  UserSettingsResponse,
  Error,
  UpdateUserSettingsRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateUserSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["user-settings"], data);
    }
  });
}

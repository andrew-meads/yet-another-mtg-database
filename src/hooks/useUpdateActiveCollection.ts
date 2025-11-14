"use client";

import { CollectionSummary } from "@/types/CardCollection";
import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";

export interface UpdateActiveCollectionRequest {
  collectionId: string;
  isActive: boolean;
}

async function updateActiveCollection({
  isActive,
  collectionId
}: UpdateActiveCollectionRequest): Promise<CollectionSummary> {
  const res = await fetch(`/api/collections/${collectionId}/isActive`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ isActive })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to update collection" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

/**
 * Hook to update the active status of a collection.
 *
 * When setting a collection to active, all other collections will be automatically
 * deactivated by the API.
 *
 * @returns Mutation result with mutate function to update active status
 */
export function useUpdateActiveCollection(): UseMutationResult<
  CollectionSummary,
  Error,
  UpdateActiveCollectionRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateActiveCollection,
    onSuccess: () => {
      // Invalidate collection summaries cache to reflect updated isActive states
      queryClient.invalidateQueries({ queryKey: ["collection-summaries"] });
    }
  });
}

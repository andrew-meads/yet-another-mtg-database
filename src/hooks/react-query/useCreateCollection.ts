"use client";

import { CardCollection, CollectionType } from "@/types/CardCollection";
import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";

export interface CreateCollectionRequest {
  name: string;
  description: string;
  collectionType: CollectionType;
}

export interface CreateCollectionResponse {
  collection: CardCollection;
}

async function createCollection(data: CreateCollectionRequest): Promise<CreateCollectionResponse> {
  const res = await fetch("/api/collections", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Failed to create collection" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

export function useCreateCollection(): UseMutationResult<
  CreateCollectionResponse,
  Error,
  CreateCollectionRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCollection,
    onSuccess: () => {
      // Invalidate collection summaries cache to trigger a refetch
      queryClient.invalidateQueries({ queryKey: ["collection-summaries"] });
    }
  });
}

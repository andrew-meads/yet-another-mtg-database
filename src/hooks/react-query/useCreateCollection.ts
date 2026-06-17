"use client";

import { Collection } from "@/types/Collection";
import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";

export interface CreateCollectionRequest {
  name: string;
  description: string;
}

export interface CreateCollectionResponse {
  collection: Collection;
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
      queryClient.invalidateQueries({ queryKey: ["collection-summaries"] });
    }
  });
}

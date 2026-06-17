import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Request type for updating a collection's metadata.
 */
export interface UpdateCollectionRequest {
  collectionId: string;
  name?: string;
  description?: string;
}

/**
 * Hook to update a collection's name and/or description.
 * PATCHes /api/collections/[id]; only provided fields are updated.
 */
export function useUpdateCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ collectionId, name, description }: UpdateCollectionRequest) => {
      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (description !== undefined) body.description = description;

      const response = await fetch(`/api/collections/${collectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update collection");
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["collection-details", variables.collectionId] });
      queryClient.invalidateQueries({ queryKey: ["collection-summaries"] });
    }
  });
}

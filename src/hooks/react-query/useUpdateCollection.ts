import { CardEntry } from "@/types/CardCollection";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Request type for updating a collection
 */
export interface UpdateCollectionRequest {
  collectionId: string;
  /** Updated collection name */
  name?: string;
  /** Updated collection description */
  description?: string;
  /** Updated cards array (full replacement) */
  cards?: Array<CardEntry>;
}

/**
 * Hook to update a collection's metadata (name, description, cards)
 *
 * Makes a PATCH request to /api/collections/[id] with partial updates
 * Only provided fields will be updated; omitted fields remain unchanged
 *
 * @example
 * const { mutate } = useUpdateCollection();
 *
 * // Update only the name
 * mutate({
 *   collectionId: "123",
 *   name: "New Collection Name"
 * });
 *
 * // Update multiple fields
 * mutate({
 *   collectionId: "123",
 *   name: "Updated Name",
 *   description: "Updated description"
 * });
 */
export function useUpdateCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ collectionId, name, description, cards }: UpdateCollectionRequest) => {
      // Build request body with only provided fields
      const body: Record<string, any> = {};
      if (name !== undefined) body.name = name;
      if (description !== undefined) body.description = description;
      if (cards !== undefined) body.cards = cards;

      const response = await fetch(`/api/collections/${collectionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update collection");
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate collection details query to refetch the updated data
      queryClient.invalidateQueries({
        queryKey: ["collection-details", variables.collectionId]
      });

      // Invalidate collection summaries since name/description may have changed
      queryClient.invalidateQueries({
        queryKey: ["collection-summaries"]
      });
    }
  });
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CardModification } from "@/types/CardModification";

/**
 * Request type for updating card quantities in a collection
 */
export interface UpdateCardQuantitiesRequest {
  collectionId: string;
  modifications: CardModification[];
}

/**
 * Hook to update card quantities in a collection
 *
 * Makes a PATCH request to /api/collections/[id]/cards with an array of modifications
 * Each modification can add, subtract, or set the quantity of a card in the collection
 *
 * @example
 * const { mutate } = useUpdateCardQuantities();
 *
 * // Add 2 copies of a card
 * mutate({
 *   collectionId: "123",
 *   modifications: [{ cardId: "card-456", operator: "add", amount: 2 }]
 * });
 *
 * // Update multiple cards at once
 * mutate({
 *   collectionId: "123",
 *   modifications: [
 *     { cardId: "card-1", operator: "add", amount: 1 },
 *     { cardId: "card-2", operator: "set", amount: 4 },
 *     { cardId: "card-3", operator: "subtract", amount: 1 }
 *   ]
 * });
 */
export function useUpdateCardQuantities() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ collectionId, modifications }: UpdateCardQuantitiesRequest) => {
      const response = await fetch(`/api/collections/${collectionId}/cards`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(modifications)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update card quantities");
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate collection details query to refetch the updated data
      queryClient.invalidateQueries({
        queryKey: ["collection-details", variables.collectionId]
      });

      // Also invalidate collection summaries in case the update affects summary data
      //   queryClient.invalidateQueries({
      //     queryKey: ["collection-summaries"],
      //   });
    }
  });
}

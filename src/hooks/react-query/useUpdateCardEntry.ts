import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";

/**
 * Request type for updating card entry notes and tags
 */
export interface UpdateCardEntryNotesRequest {
  collectionId: string;
  cardIndex: number;
  notes?: string;
  quantity?: number;
  tags?: string[];
}

async function updateCardEntry({
  collectionId,
  cardIndex,
  notes,
  quantity,
  tags
}: UpdateCardEntryNotesRequest): Promise<any> {
  const body: { notes?: string; tags?: string[]; quantity?: number } = {};
  if (notes !== undefined) body.notes = notes;
  if (tags !== undefined) body.tags = tags;
  if (quantity !== undefined) body.quantity = quantity;

  // Log the collectionId, cardIndex and body for debugging
  console.log("Updating card entry:", collectionId, cardIndex, JSON.stringify(body));

  const response = await fetch(`/api/collections/${collectionId}/cards/${cardIndex}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update card entry");
  }

  return response.json();
}

/**
 * Hook to update notes and/or tags for a specific card entry in a collection
 *
 * Makes a PATCH request to /api/collections/[id]/cards/[index] to update
 * the notes and tags of a card entry at the specified index
 *
 * @example
 * const { mutate } = useUpdateCardEntryNotes();
 *
 * // Update notes only
 * mutate({
 *   collectionId: "123",
 *   cardIndex: 0,
 *   notes: "Foil version, mint condition"
 * });
 *
 * // Update tags only
 * mutate({
 *   collectionId: "123",
 *   cardIndex: 2,
 *   tags: ["commander", "staple"]
 * });
 *
 * // Update both notes and tags
 * mutate({
 *   collectionId: "123",
 *   cardIndex: 5,
 *   notes: "Trade bait",
 *   tags: ["trade", "vintage"]
 * });
 */
export function useUpdateCardEntry(): UseMutationResult<any, Error, UpdateCardEntryNotesRequest> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCardEntry,
    onSuccess: (_, variables) => {
      // Invalidate collection details query to refetch the updated data
      queryClient.invalidateQueries({
        queryKey: ["collection-details", variables.collectionId]
      });

      // Also invalidate collection summaries in case this affects any summary data
      queryClient.invalidateQueries({
        queryKey: ["collection-summaries"]
      });

      // Invalidate card locations since collection contents may have changed
      queryClient.invalidateQueries({
        queryKey: ["card-locations"]
      });

      // Invalidate tags query if there were any tags added
      if (variables.tags && variables.tags.length > 0) {
        queryClient.invalidateQueries({
          queryKey: ["tags"]
        });
      }
    }
  });
}

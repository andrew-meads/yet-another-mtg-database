import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";

interface DeleteCardEntryArgs {
  collectionId: string;
  cardIndex: number;
}

async function deleteCardEntry({ collectionId, cardIndex }: DeleteCardEntryArgs): Promise<void> {
  const res = await fetch(`/api/collections/${collectionId}/cards/${cardIndex}`, {
    method: "DELETE"
  });
  if (!res.ok && res.status !== 204) throw new Error("Failed to delete card entry");
}

export function useDeleteCardEntry(): UseMutationResult<void, Error, DeleteCardEntryArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCardEntry,
    onSuccess: (_data, { collectionId }) => {
      queryClient.invalidateQueries({ queryKey: ["collection-details", collectionId] });
      queryClient.invalidateQueries({ queryKey: ["collection-summaries"] });
    }
  });
}

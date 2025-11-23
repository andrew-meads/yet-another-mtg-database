import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";
import { CardEntry } from "@/types/CardCollection";

interface PushCardEntryArgs {
  collectionId: string;
  cardEntry: CardEntry;
}

async function pushCardEntry({ collectionId, cardEntry }: PushCardEntryArgs): Promise<any> {
  const res = await fetch(`/api/collections/${collectionId}/cards`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cardEntry)
  });
  if (!res.ok) throw new Error("Failed to add card entry");
  return await res.json();
}

export function usePushCardEntryToCollection(): UseMutationResult<any, Error, PushCardEntryArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: pushCardEntry,
    onSuccess: (_data, { collectionId }) => {
      queryClient.invalidateQueries({ queryKey: ["collection-details", collectionId] });
    }
  });
}

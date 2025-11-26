import { useMutation, UseMutationResult, useQueryClient } from "@tanstack/react-query";
import { CardEntry } from "@/types/CardCollection";

interface PatchCardsBody {
  collectionId: string;

  /** Which action to take */
  action: "add" | "append" | "remove" | "swap" | "move" | "merge" | "swap-or-merge";
  /** If the action is "add" or "append", this entry will be added / appended */
  entry?: CardEntry;
  /** If the action is "remove", "swap", or "move", this is the index to remove/move from */
  fromIndex?: number;
  /** If the action is "swap" or "move", this is the index to move/swap to */
  toIndex?: number;
  /**
   * If the action is "add" or "append", this is the quantity to add (defaults to 1).
   * If the action is "remove", this is the quantity to remove (defaults to all).
   * If the action is "move", this specifies how many cards to move (defaults to all).
   */
  quantity?: number;
}

async function updateCards({
  collectionId,
  action,
  entry,
  fromIndex,
  toIndex,
  quantity
}: PatchCardsBody): Promise<any> {
  const res = await fetch(`/api/collections/${collectionId}/cards`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, entry, fromIndex, toIndex, quantity })
  });
  if (!res.ok) throw new Error("Failed to add card entry");
  return await res.json();
}

export function useUpdateCollectionCards(): UseMutationResult<any, Error, PatchCardsBody> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCards,
    onSuccess: (_data, { collectionId }) => {
      queryClient.invalidateQueries({ queryKey: ["collection-details", collectionId] });
    }
  });
}

"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import { useUpdatePhysicalCard } from "@/hooks/react-query/useUpdatePhysicalCard";
import { useDeckCardOp } from "@/hooks/react-query/useDeckCardOp";
import { CollectionGroupRow } from "@/components/my-cards-page/collection-view/grouping";

/**
 * Actions on a collection-table row's existing physical copies, shared by the
 * row context menu and the collection table's keyboard shortcuts. Each action
 * affects exactly ONE copy of the row (repeat to act on more), never creates
 * copies, and reports every disallowed case with an error toast instead of
 * failing silently:
 *  - moveOneToCollection: change one copy's home collection (deck assignment,
 *    if any, is kept — mirroring collection→collection drag).
 *  - addOneToDeck: place one copy into a deck (loose rows only; the server
 *    appends to the deck's first section/column).
 *  - removeOneFromDeck: pull one copy out of the row's deck.
 */
export function useCollectionRowActions(collectionId: string) {
  const { activeCollection, activeDeck } = useOpenEntitiesContext();
  const updateCard = useUpdatePhysicalCard();
  const deckOp = useDeckCardOp();

  /** Move one copy to `targetCollectionId`, or the active collection when omitted. */
  const moveOneToCollection = useCallback(
    (row: CollectionGroupRow, targetCollectionId?: string) => {
      const target = targetCollectionId ?? activeCollection?._id;
      if (!target) {
        toast.error("Set an active collection first.");
        return;
      }
      if (target === collectionId) {
        toast.error(
          targetCollectionId
            ? "These copies are already in this collection."
            : "This is already the active collection."
        );
        return;
      }
      updateCard.mutate({ physicalCardId: row.physicalCardIds[0], collectionId: target });
    },
    [activeCollection, collectionId, updateCard]
  );

  /** Place one copy into `targetDeckId`, or the active deck when omitted. */
  const addOneToDeck = useCallback(
    (row: CollectionGroupRow, targetDeckId?: string) => {
      if (row.deckId) {
        toast.error(
          `Already in ${row.deckName ?? "a deck"} — remove these copies from that deck first.`
        );
        return;
      }
      const target = targetDeckId ?? activeDeck?._id;
      if (!target) {
        toast.error("Set an active deck before adding cards to a deck.");
        return;
      }
      deckOp.mutate({ deckId: target, op: "place", physicalCardId: row.physicalCardIds[0] });
    },
    [activeDeck, deckOp]
  );

  /** Remove one copy of a deck-assigned row from its deck (it stays in the collection). */
  const removeOneFromDeck = useCallback(
    (row: CollectionGroupRow) => {
      if (!row.deckId) return;
      deckOp.mutate({ deckId: row.deckId, op: "remove", physicalCardId: row.physicalCardIds[0] });
    },
    [deckOp]
  );

  return { moveOneToCollection, addOneToDeck, removeOneFromDeck };
}

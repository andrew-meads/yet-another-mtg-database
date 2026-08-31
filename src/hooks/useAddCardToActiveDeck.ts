"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import { useCreatePhysicalCard } from "@/hooks/react-query/useCreatePhysicalCard";
import { useSearchAddMeta } from "@/context/SearchAddMetaContext";
import { MtgCard } from "@/types/MtgCard";

/**
 * Returns a callback that adds a card to the user's active deck.
 *
 * Mirrors the search → deck drag semantics in `useDropDispatch`: the new copy is
 * created in the active collection and placed into the active deck in one call.
 * With no section/column/index the server appends it to the deck's first
 * section/first column.
 *
 * With `options.ephemeral`, the copy is created with no collection (an
 * ephemeral, deck-only card) — no active collection is required.
 *
 * @param deckId Optional deck to target instead of the active deck.
 */
export function useAddCardToActiveDeck() {
  const { activeCollection, activeDeck } = useOpenEntitiesContext();
  const { mutate: createPhysicalCard } = useCreatePhysicalCard();
  const { notes, tags } = useSearchAddMeta();

  return useCallback(
    (card: MtgCard, deckId?: string, options?: { ephemeral?: boolean }) => {
      const targetDeckId = deckId ?? activeDeck?._id;
      if (!targetDeckId) {
        toast.error("Set an active deck before adding cards to a deck.");
        return;
      }

      if (options?.ephemeral) {
        createPhysicalCard({
          cardId: card.id,
          deckId: targetDeckId,
          notes: notes || undefined,
          tags: tags.length ? tags : undefined
        });
        return;
      }

      if (!activeCollection) {
        toast.error("Set an active collection before adding cards to a deck.");
        return;
      }

      createPhysicalCard({
        cardId: card.id,
        collectionId: activeCollection._id,
        deckId: targetDeckId,
        notes: notes || undefined,
        tags: tags.length ? tags : undefined
      });
    },
    [activeCollection, activeDeck, createPhysicalCard, notes, tags]
  );
}

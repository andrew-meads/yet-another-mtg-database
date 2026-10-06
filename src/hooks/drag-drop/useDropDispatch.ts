"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { AnyDragItem, DropTarget, PhysicalCardDragItem } from "./Types";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import { useCreatePhysicalCard } from "@/hooks/react-query/useCreatePhysicalCard";
import { useMovePhysicalCards } from "@/hooks/react-query/useMovePhysicalCards";
import { useDeckCardOp } from "@/hooks/react-query/useDeckCardOp";
import { useAddColumn } from "@/hooks/react-query/useDeckColumns";
import { useAddSection } from "@/hooks/react-query/useDeckSections";

type ConcreteTarget =
  | { kind: "collection"; collectionId: string }
  | { kind: "deck"; deckId: string; sectionId?: string; columnId?: string; index?: number };

/**
 * Central drag-and-drop dispatcher. Translates a dragged item + drop target into
 * the concrete API mutations implementing the agreed semantics:
 *  - search → collection: create a new physical card
 *  - search → deck: create in the active collection, then place in the deck
 *  - collection → collection: move the card's collection
 *  - collection/deck → deck: place into the deck (clearing any prior deck)
 *  - deck → collection: remove from the deck, then move collection if different
 * A multi-copy drag is batched: at most one deck request plus one collection move.
 */
export function useDropDispatch() {
  const { activeCollection } = useOpenEntitiesContext();
  const createCard = useCreatePhysicalCard();
  const moveCards = useMovePhysicalCards();
  const deckCardOp = useDeckCardOp();
  const addColumn = useAddColumn();
  const addSection = useAddSection();

  return useCallback(
    async (item: AnyDragItem, target: DropTarget) => {
      // Ephemeral (deck-only) cards may only be reordered within their own deck.
      // Reject before resolving the target so we never create empty columns/sections.
      if (item.kind === "physical" && item.isEphemeral && !ephemeralDropAllowed(item, target)) {
        return;
      }

      const concrete = await resolveTarget(target, addColumn, addSection);
      if (!concrete) return;

      // --- New card from search ---
      if (item.kind === "new") {
        if (concrete.kind === "collection") {
          await createCard.mutateAsync({
            cardId: item.card.id,
            collectionId: concrete.collectionId,
            ...(item.notes && { notes: item.notes }),
            ...(item.tags?.length && { tags: item.tags }),
            ...(item.finish && { finish: item.finish }),
            ...(item.condition && { condition: item.condition })
          });
          return;
        }
        if (!activeCollection) {
          toast.error("Set an active collection before adding cards to a deck.");
          return;
        }
        await createCard.mutateAsync({
          cardId: item.card.id,
          collectionId: activeCollection._id,
          deckId: concrete.deckId,
          sectionId: concrete.sectionId,
          columnId: concrete.columnId,
          index: concrete.index,
          ...(item.notes && { notes: item.notes }),
          ...(item.tags?.length && { tags: item.tags }),
          ...(item.finish && { finish: item.finish }),
          ...(item.condition && { condition: item.condition })
        });
        return;
      }

      // --- Existing physical card(s) ---
      if (concrete.kind === "deck") {
        // collection→deck, deck→deck, or intra-deck reorder: one request places every
        // copy, in order, starting at the drop index.
        await deckCardOp.mutateAsync({
          deckId: concrete.deckId,
          op: "place",
          physicalCardIds: item.physicalCardIds,
          sectionId: concrete.sectionId,
          columnId: concrete.columnId,
          index: concrete.index
        });
        return;
      }

      // Target is a collection.
      const targetCollectionId = concrete.collectionId;
      // deck → collection: drop the deck assignment. Dragging from a collection
      // row never changes deck membership, even if the row is deck-assigned.
      if (item.origin.type === "deck" && item.sourceDeckId) {
        await deckCardOp.mutateAsync({
          deckId: item.sourceDeckId,
          op: "remove",
          physicalCardIds: item.physicalCardIds
        });
      }
      // Change collection if it actually differs.
      if (targetCollectionId !== item.sourceCollectionId) {
        await moveCards.mutateAsync({
          physicalCardIds: item.physicalCardIds,
          collectionId: targetCollectionId
        });
      }
    },
    [activeCollection, createCard, moveCards, deckCardOp, addColumn, addSection]
  );
}

/**
 * An ephemeral card may only be dropped back onto its own deck (any column/section,
 * including new ones). Dropping onto a collection or a different deck is a no-op.
 */
export function ephemeralDropAllowed(item: PhysicalCardDragItem, target: DropTarget): boolean {
  switch (target.kind) {
    case "collection":
      return false;
    case "entity-button":
      return target.entity.kind === "deck" && target.entity._id === item.sourceDeckId;
    case "deck-column":
    case "deck-new-column":
    case "deck-new-section":
      return target.deckId === item.sourceDeckId;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function resolveTarget(
  target: DropTarget,
  addColumn: { mutateAsync: (v: any) => Promise<any> },
  addSection: { mutateAsync: (v: any) => Promise<any> }
): Promise<ConcreteTarget | null> {
  switch (target.kind) {
    case "collection":
      return { kind: "collection", collectionId: target.collectionId };
    case "entity-button":
      return target.entity.kind === "collection"
        ? { kind: "collection", collectionId: target.entity._id }
        : { kind: "deck", deckId: target.entity._id };
    case "deck-column":
      return {
        kind: "deck",
        deckId: target.deckId,
        sectionId: target.sectionId,
        columnId: target.columnId,
        index: target.index
      };
    case "deck-new-column": {
      const res = await addColumn.mutateAsync({
        deckId: target.deckId,
        sectionId: target.sectionId
      });
      return {
        kind: "deck",
        deckId: target.deckId,
        sectionId: target.sectionId,
        columnId: res.columnId,
        index: 0
      };
    }
    case "deck-new-section": {
      const res = await addSection.mutateAsync({ deckId: target.deckId, name: "New Section" });
      // The new section is seeded with one column; placing with columnId undefined
      // lands in that seeded column.
      return { kind: "deck", deckId: target.deckId, sectionId: res.sectionId, index: 0 };
    }
  }
}

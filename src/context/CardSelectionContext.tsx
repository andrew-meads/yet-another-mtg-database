"use client";

import { createContext, useCallback, useContext, useMemo } from "react";

import type { SlimMtgCard } from "@/types/MtgCard";
import type { CardCondition, CardFinish } from "@/lib/cardAttributes";
import type { RowCopyPrice } from "@/lib/copyPricing";
import { useLocalStorage } from "@/hooks/useLocalStorage";

/**
 * The physical copies the user clicked alongside a card (a collection row, a
 * deck card, a card-locations row) — a snapshot of what identifies and prices
 * them. The selected-card panel prefers the LIVE records for these ids (from
 * the card-locations query) and falls back to this snapshot.
 */
export interface SelectedCopies {
  /** Scryfall id of the printing the copies are of (guards against a stale pairing). */
  cardId: string;
  physicalCardIds: string[];
  finish: CardFinish;
  condition: CardCondition;
  isProxy: boolean;
  copyPrice?: RowCopyPrice;
  /** Where the copies live, for the panel's caption ("in Main Collection"). */
  locationName?: string;
}

interface CardSelectionContextType {
  selectedCard: SlimMtgCard | null;
  /** The copies selected with the card, or null when a printing was selected on its own. */
  selectedCopies: SelectedCopies | null;
  /**
   * Select a card, optionally with the physical copies it was clicked as.
   * Omitting `copies` clears any previous copy selection (e.g. a search result).
   */
  setSelectedCard: (card: SlimMtgCard | null, copies?: SelectedCopies | null) => void;
}

const CardSelectionContext = createContext<CardSelectionContextType | undefined>(undefined);

export function CardSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedCard, setStoredCard] = useLocalStorage<SlimMtgCard | null>("selected-card", null);
  const [selectedCopies, setStoredCopies] = useLocalStorage<SelectedCopies | null>(
    "selected-copies",
    null
  );

  const setSelectedCard = useCallback(
    (card: SlimMtgCard | null, copies: SelectedCopies | null = null) => {
      setStoredCard(card);
      setStoredCopies(card && copies && copies.cardId === card.id ? copies : null);
    },
    [setStoredCard, setStoredCopies]
  );

  const value = useMemo(
    () => ({ selectedCard, selectedCopies, setSelectedCard }),
    [selectedCard, selectedCopies, setSelectedCard]
  );

  return <CardSelectionContext.Provider value={value}>{children}</CardSelectionContext.Provider>;
}

export function useCardSelection(): CardSelectionContextType {
  const ctx = useContext(CardSelectionContext);
  if (!ctx) {
    // Return a safe noop fallback to avoid breaking callers outside provider.
    return {
      selectedCard: null,
      selectedCopies: null,
      setSelectedCard: () => {}
    };
  }
  return ctx;
}

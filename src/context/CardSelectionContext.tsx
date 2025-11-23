"use client";

import { createContext, useContext } from "react";

import type { MtgCard } from "@/types/MtgCard";
import { useLocalStorage } from "@/hooks/useLocalStorage";

interface CardSelectionContextType {
  selectedCard: MtgCard | null;
  setSelectedCard: (card: MtgCard | null) => void;
}

const CardSelectionContext = createContext<CardSelectionContextType | undefined>(undefined);

export function CardSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedCard, setSelectedCard] = useLocalStorage<MtgCard | null>("selected-card", null);

  return (
    <CardSelectionContext.Provider value={{ selectedCard, setSelectedCard }}>
      {children}
    </CardSelectionContext.Provider>
  );
}

export function useCardSelection(): CardSelectionContextType {
  const ctx = useContext(CardSelectionContext);
  if (!ctx) {
    // Return a safe noop fallback to avoid breaking callers outside provider.
    return {
      selectedCard: null,
      setSelectedCard: () => {}
    };
  }
  return ctx;
}

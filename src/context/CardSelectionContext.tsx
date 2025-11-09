"use client";

import { createContext, useContext, useState } from "react";

import type { MtgCard } from "@/types/MtgCard";

interface CardSelectionContextType {
  selectedCard: MtgCard | null;
  setSelectedCard: (card: MtgCard | null) => void;
}

const CardSelectionContext = createContext<CardSelectionContextType | undefined>(undefined);

export function CardSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedCard, setSelectedCard] = useState<MtgCard | null>(null);

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

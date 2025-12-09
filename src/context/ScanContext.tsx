"use client";

import { createContext, useContext, useState } from "react";
import { RecognizedCard } from "@/types/RecognizedCard";
import { MtgCard } from "@/types/MtgCard";

interface ScanContextType {
  scannedImage: Blob | null;
  setScannedImage: (blob: Blob) => void;

  recognized: RecognizedCard | null;
  setRecognized: (recognized: RecognizedCard) => void;

  cards: MtgCard[];
  setCards: (cards: MtgCard[]) => void;
}

const ScanContext = createContext<ScanContextType>({
  scannedImage: null,
  setScannedImage: () => {},
  recognized: null,
  setRecognized: () => {},
  cards: [],
  setCards: () => {}
});

export function ScanContextProvider({ children }: { children: React.ReactNode }) {
  const [scannedImage, setScannedImage] = useState<Blob | null>(null);
  const [recognized, setRecognized] = useState<RecognizedCard | null>(null);
  const [cards, setCards] = useState<MtgCard[]>([]);

  return (
    <ScanContext.Provider
      value={{ scannedImage, setScannedImage, recognized, setRecognized, cards, setCards }}
    >
      {children}
    </ScanContext.Provider>
  );
}

export function useScanContext() {
  const ctx = useContext(ScanContext);
  if (!ctx) {
    // Return a safe noop fallback to avoid breaking callers outside provider.
    return {
      scannedImage: null,
      setScannedImage: () => {},
      recognized: null,
      setRecognized: () => {},
      cards: [],
      setCards: () => {}
    };
  }
  return ctx;
}

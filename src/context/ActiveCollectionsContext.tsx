"use client";

import { CollectionSummary } from "@/types/CardCollection";
import { createContext, useCallback, useContext, useRef, useState } from "react";

interface CustomNavButtonContextType {
  addActiveCollection: (collection: CollectionSummary) => void;
  removeActiveCollection: (id: string) => void;
  activeCollections: CollectionSummary[];
}

const ActiveCollectionsContext = createContext<CustomNavButtonContextType | undefined>(undefined);

export function useActiveCollectionsContext(): CustomNavButtonContextType {
  const ctx = useContext(ActiveCollectionsContext);
  if (!ctx) {
    throw new Error("useActiveCollectionsContext must be used within a ActiveCollectionsProvider");
  }
  return ctx;
}

export function ActiveCollectionsProvider({ children }: { children: React.ReactNode }) {
  const [activeCollections, setActiveCollections] = useState<CollectionSummary[]>([]);
  const justRemovedRef = useRef<string | null>(null);

  const addActiveCollection = (collection: CollectionSummary) => {
    // If this collection was just removed by user, don't re-add it
    if (justRemovedRef.current === collection._id) {
      return;
    }

    const existingButton = activeCollections.find((c) => c._id === collection._id);
    if (existingButton) return;

    setActiveCollections([...activeCollections, collection]);
  };

  const removeActiveCollection = (id: string) => {
    setActiveCollections(activeCollections.filter((c) => c._id !== id));
    // Mark as just removed
    justRemovedRef.current = id;
    // Clear the flag after a short delay to allow re-adding later
    setTimeout(() => {
      if (justRemovedRef.current === id) {
        justRemovedRef.current = null;
      }
    }, 100);
  };

  return (
    <ActiveCollectionsContext.Provider
      value={{ addActiveCollection, removeActiveCollection, activeCollections }}
    >
      {children}
    </ActiveCollectionsContext.Provider>
  );
}

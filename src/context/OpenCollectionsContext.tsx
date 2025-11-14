"use client";

import { useUpdateActiveCollection } from "@/hooks/useUpdateActiveCollection";
import { CollectionSummary } from "@/types/CardCollection";
import { createContext, useContext, useRef, useState } from "react";

interface OpenCollectionContextType {
  addOpenCollection: (collection: CollectionSummary) => void;
  removeOpenCollection: (id: string) => void;
  openCollections: CollectionSummary[];
  activeCollection: CollectionSummary | null;
  setActiveCollection: (collection: CollectionSummary) => void;
}

const OpenCollectionsContext = createContext<OpenCollectionContextType | undefined>(undefined);

export function useOpenCollectionsContext(): OpenCollectionContextType {
  const ctx = useContext(OpenCollectionsContext);
  if (!ctx) {
    throw new Error("useActiveCollectionsContext must be used within a ActiveCollectionsProvider");
  }
  return ctx;
}

/**
 * Provider component to manage open card collections in the UI.
 */
export function OpenCollectionsProvider({ children }: { children: React.ReactNode }) {
  const [openCollections, setOpenCollections] = useState<CollectionSummary[]>([]);
  const [activeCollection, setActiveCollection] = useState<CollectionSummary | null>(null);
  const { mutateAsync } = useUpdateActiveCollection();

  const justRemovedRef = useRef<string | null>(null);

  /**
   * Add a collection to the list of open collections
   *
   * @param collection The collection to add
   */
  const addOpenCollection = (collection: CollectionSummary) => {
    // If this collection was just removed by user, don't re-add it
    if (justRemovedRef.current === collection._id) {
      return;
    }

    const existingCollection = openCollections.find((c) => c._id === collection._id);
    if (existingCollection) return;

    if (collection.isActive) setActiveCollection(collection);

    setOpenCollections([...openCollections, collection]);
  };

  /**
   * Remove a collection from the list of open collections
   *
   * @param id The ID of the collection to remove
   */
  const removeOpenCollection = (id: string) => {
    setOpenCollections(openCollections.filter((c) => c._id !== id));
    // Mark as just removed
    justRemovedRef.current = id;
    // Clear the flag after a short delay to allow re-adding later
    setTimeout(() => {
      if (justRemovedRef.current === id) {
        justRemovedRef.current = null;
      }
    }, 100);
  };

  const setActiveCollectionWithApiCall = async (collection: CollectionSummary) => {
    // Optimistic update
    const oldActive = activeCollection;
    setActiveCollection(collection);

    // Call API to set this collection as active
    try {
      await mutateAsync({ collectionId: collection._id, isActive: true });
    } catch (error) {
      // Revert on error
      setActiveCollection(oldActive);
      throw error;
    }
  };

  return (
    <OpenCollectionsContext.Provider
      value={{
        addOpenCollection,
        removeOpenCollection,
        openCollections,
        activeCollection,
        setActiveCollection: setActiveCollectionWithApiCall
      }}
    >
      {children}
    </OpenCollectionsContext.Provider>
  );
}

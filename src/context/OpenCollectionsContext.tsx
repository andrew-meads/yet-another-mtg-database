"use client";

import { useUpdateActiveCollection } from "@/hooks/useUpdateActiveCollection";
import { useRetrieveCollectionSummaries } from "@/hooks/useRetrieveCollectionSummaries";
import { CollectionSummary } from "@/types/CardCollection";
import { createContext, useContext, useMemo, useRef, useState } from "react";

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
 * 
 * Maintains a list of open collection IDs and derives the full collection objects
 * from the cached collection summaries. This ensures that any updates to collections
 * (e.g., name changes, active status) are automatically reflected in the UI.
 */
export function OpenCollectionsProvider({ children }: { children: React.ReactNode }) {
  // Store only the IDs of open collections
  const [openCollectionIds, setOpenCollectionIds] = useState<string[]>([]);
  const { mutateAsync } = useUpdateActiveCollection();
  
  // Fetch all collection summaries from the cache
  const { data } = useRetrieveCollectionSummaries();
  const allCollections = data?.collections || [];

  const justRemovedRef = useRef<string | null>(null);

  // Derive the actual collection objects from the IDs and cached data
  const openCollections = useMemo(() => {
    return openCollectionIds
      .map((id) => allCollections.find((c) => c._id === id))
      .filter((c): c is CollectionSummary => c !== undefined);
  }, [openCollectionIds, allCollections]);

  const activeCollection = openCollections.find((c) => c.isActive) || null;

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

    if (openCollectionIds.includes(collection._id)) return;

    setOpenCollectionIds([...openCollectionIds, collection._id]);
  };

  /**
   * Remove a collection from the list of open collections
   *
   * @param id The ID of the collection to remove
   */
  const removeOpenCollection = (id: string) => {
    setOpenCollectionIds(openCollectionIds.filter((cId) => cId !== id));
    // Mark as just removed
    justRemovedRef.current = id;
    // Clear the flag after a short delay to allow re-adding later
    setTimeout(() => {
      if (justRemovedRef.current === id) {
        justRemovedRef.current = null;
      }
    }, 100);
  };

  const setActiveCollection = async (collection: CollectionSummary) => {
    await mutateAsync({ collectionId: collection._id, isActive: true });
  };

  return (
    <OpenCollectionsContext.Provider
      value={{
        addOpenCollection,
        removeOpenCollection,
        openCollections,
        activeCollection,
        setActiveCollection
      }}
    >
      {children}
    </OpenCollectionsContext.Provider>
  );
}

"use client";

import { useUpdateActiveCollection } from "@/hooks/react-query/useUpdateActiveCollection";
import { useRetrieveCollectionSummaries } from "@/hooks/react-query/useRetrieveCollectionSummaries";
import { useRetrieveDeckSummaries } from "@/hooks/react-query/useRetrieveDeckSummaries";
import { CollectionSummary } from "@/types/Collection";
import { OpenEntitySummary } from "@/types/Deck";
import { createContext, useContext, useMemo, useRef } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";

interface OpenEntityRef {
  id: string;
  kind: "collection" | "deck";
}

interface OpenEntitiesContextType {
  addOpenEntity: (entity: OpenEntitySummary) => void;
  removeOpenEntity: (id: string) => void;
  openEntities: OpenEntitySummary[];
  /** The user's active collection (decks cannot be active), or null. */
  activeCollection: CollectionSummary | null;
  setActiveCollection: (collection: CollectionSummary) => void;
}

const OpenEntitiesContext = createContext<OpenEntitiesContextType | undefined>(undefined);

export function useOpenEntitiesContext(): OpenEntitiesContextType {
  const ctx = useContext(OpenEntitiesContext);
  if (!ctx) {
    throw new Error("useOpenEntitiesContext must be used within an OpenEntitiesProvider");
  }
  return ctx;
}

/**
 * Tracks which collections and decks are open in the workspace. Stores only
 * { id, kind } refs in localStorage and derives the full summaries from the
 * cached collection + deck summary queries.
 */
export function OpenEntitiesProvider({ children }: { children: React.ReactNode }) {
  const [openRefs, setOpenRefs] = useLocalStorage<OpenEntityRef[]>("open-entity-ids", []);
  const { mutateAsync } = useUpdateActiveCollection();

  const { data: collectionsData } = useRetrieveCollectionSummaries();
  const { data: decksData } = useRetrieveDeckSummaries();
  const collections = useMemo(() => collectionsData?.collections ?? [], [collectionsData]);
  const decks = useMemo(() => decksData?.decks ?? [], [decksData]);

  const justRemovedRef = useRef<string | null>(null);

  const openEntities = useMemo(() => {
    return openRefs
      .map((ref) =>
        ref.kind === "collection"
          ? collections.find((c) => c._id === ref.id)
          : decks.find((d) => d._id === ref.id)
      )
      .filter((e): e is OpenEntitySummary => e !== undefined);
  }, [openRefs, collections, decks]);

  const activeCollection = collections.find((c) => c.isActive) ?? null;

  const addOpenEntity = (entity: OpenEntitySummary) => {
    if (justRemovedRef.current === entity._id) return;
    if (openRefs.some((ref) => ref.id === entity._id)) return;
    setOpenRefs([...openRefs, { id: entity._id, kind: entity.kind }]);
  };

  const removeOpenEntity = (id: string) => {
    setOpenRefs(openRefs.filter((ref) => ref.id !== id));
    justRemovedRef.current = id;
    setTimeout(() => {
      if (justRemovedRef.current === id) justRemovedRef.current = null;
    }, 100);
  };

  const setActiveCollection = async (collection: CollectionSummary) => {
    await mutateAsync({ collectionId: collection._id, isActive: true });
  };

  return (
    <OpenEntitiesContext.Provider
      value={{
        addOpenEntity,
        removeOpenEntity,
        openEntities,
        activeCollection,
        setActiveCollection
      }}
    >
      {children}
    </OpenEntitiesContext.Provider>
  );
}

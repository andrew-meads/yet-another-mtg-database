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
  /** Whether the user has pinned this entity to the main bar. Missing = unpinned. */
  pinned?: boolean;
}

interface OpenEntitiesContextType {
  addOpenEntity: (entity: OpenEntitySummary) => void;
  removeOpenEntity: (id: string) => void;
  openEntities: OpenEntitySummary[];
  /**
   * Open entities the user has pinned to the main bar (the active collection is
   * always treated as pinned). These render inline as drop targets.
   */
  pinnedEntities: OpenEntitySummary[];
  /** Open entities that are not pinned. These live behind the "More" menu. */
  unpinnedEntities: OpenEntitySummary[];
  /** Whether an open entity is effectively pinned (explicit pin or active collection). */
  isPinned: (id: string) => boolean;
  /** Toggle the pin flag for an open entity. No-op for the active collection. */
  togglePin: (id: string) => void;
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

  /** An entity is effectively pinned if explicitly pinned or it is the active collection. */
  const isPinned = (id: string) => {
    if (activeCollection?._id === id) return true;
    return openRefs.some((ref) => ref.id === id && ref.pinned === true);
  };

  const { pinnedEntities, unpinnedEntities } = useMemo(() => {
    const pinned: OpenEntitySummary[] = [];
    const unpinned: OpenEntitySummary[] = [];
    for (const entity of openEntities) {
      const ref = openRefs.find((r) => r.id === entity._id);
      const effectivelyPinned =
        ref?.pinned === true || (entity.kind === "collection" && entity.isActive === true);
      if (effectivelyPinned) pinned.push(entity);
      else unpinned.push(entity);
    }
    // Active collection sorts first within the pinned strip.
    pinned.sort((a, b) => {
      const aActive = a.kind === "collection" && a.isActive ? 0 : 1;
      const bActive = b.kind === "collection" && b.isActive ? 0 : 1;
      return aActive - bActive;
    });
    return { pinnedEntities: pinned, unpinnedEntities: unpinned };
  }, [openEntities, openRefs]);

  const addOpenEntity = (entity: OpenEntitySummary) => {
    if (justRemovedRef.current === entity._id) return;
    if (openRefs.some((ref) => ref.id === entity._id)) return;
    setOpenRefs([...openRefs, { id: entity._id, kind: entity.kind }]);
  };

  const togglePin = (id: string) => {
    // The active collection is always pinned; pinning is a no-op there.
    if (activeCollection?._id === id) return;
    setOpenRefs(openRefs.map((ref) => (ref.id === id ? { ...ref, pinned: !ref.pinned } : ref)));
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
        pinnedEntities,
        unpinnedEntities,
        isPinned,
        togglePin,
        activeCollection,
        setActiveCollection
      }}
    >
      {children}
    </OpenEntitiesContext.Provider>
  );
}

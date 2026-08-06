"use client";

import { useUpdateActiveCollection } from "@/hooks/react-query/useUpdateActiveCollection";
import { useUpdateActiveDeck } from "@/hooks/react-query/useUpdateActiveDeck";
import { useRetrieveCollectionSummaries } from "@/hooks/react-query/useRetrieveCollectionSummaries";
import { useRetrieveDeckSummaries } from "@/hooks/react-query/useRetrieveDeckSummaries";
import { CollectionSummary } from "@/types/Collection";
import { DeckSummary, OpenEntitySummary } from "@/types/Deck";
import { createContext, useContext, useMemo, useRef } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { collectionSearchStorageKey } from "@/lib/collectionUtils";

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
   * Open entities the user has pinned to the main bar (the active collection and
   * active deck are always treated as pinned). These render inline as drop targets.
   */
  pinnedEntities: OpenEntitySummary[];
  /** Open entities that are not pinned. These live behind the "More" menu. */
  unpinnedEntities: OpenEntitySummary[];
  /** Whether an open entity is effectively pinned (explicit pin or active entity). */
  isPinned: (id: string) => boolean;
  /** Toggle the pin flag for an open entity. No-op for the active collection/deck. */
  togglePin: (id: string) => void;
  /**
   * The user's active collection, or null. Independent of the active deck — a
   * collection and a deck can be active at the same time.
   */
  activeCollection: CollectionSummary | null;
  setActiveCollection: (collection: CollectionSummary) => void;
  /** The user's active deck, or null. */
  activeDeck: DeckSummary | null;
  setActiveDeck: (deck: DeckSummary) => void;
  /** Makes an entity active, dispatching to the collection or deck mutation. */
  setActiveEntity: (entity: OpenEntitySummary) => void;
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
  const { mutateAsync: mutateActiveCollection } = useUpdateActiveCollection();
  const { mutateAsync: mutateActiveDeck } = useUpdateActiveDeck();

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
  const activeDeck = decks.find((d) => d.isActive) ?? null;

  /** An entity is effectively pinned if explicitly pinned or it is an active entity. */
  const isPinned = (id: string) => {
    if (activeCollection?._id === id || activeDeck?._id === id) return true;
    return openRefs.some((ref) => ref.id === id && ref.pinned === true);
  };

  const { pinnedEntities, unpinnedEntities } = useMemo(() => {
    const pinned: OpenEntitySummary[] = [];
    const unpinned: OpenEntitySummary[] = [];
    for (const entity of openEntities) {
      const ref = openRefs.find((r) => r.id === entity._id);
      const effectivelyPinned = ref?.pinned === true || entity.isActive === true;
      if (effectivelyPinned) pinned.push(entity);
      else unpinned.push(entity);
    }
    // Active entities sort first within the pinned strip (active collection, then
    // active deck, then everything else).
    const activeRank = (e: OpenEntitySummary) => {
      if (!e.isActive) return 2;
      return e.kind === "collection" ? 0 : 1;
    };
    pinned.sort((a, b) => activeRank(a) - activeRank(b));
    return { pinnedEntities: pinned, unpinnedEntities: unpinned };
  }, [openEntities, openRefs]);

  const addOpenEntity = (entity: OpenEntitySummary) => {
    if (justRemovedRef.current === entity._id) return;
    if (openRefs.some((ref) => ref.id === entity._id)) return;
    setOpenRefs([...openRefs, { id: entity._id, kind: entity.kind }]);
  };

  const togglePin = (id: string) => {
    // Active entities are always pinned; pinning is a no-op there.
    if (activeCollection?._id === id || activeDeck?._id === id) return;
    setOpenRefs(openRefs.map((ref) => (ref.id === id ? { ...ref, pinned: !ref.pinned } : ref)));
  };

  const removeOpenEntity = (id: string) => {
    setOpenRefs(openRefs.filter((ref) => ref.id !== id));
    // Forget the closed collection's persisted search string. No-op for deck ids
    // (the key never existed).
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(collectionSearchStorageKey(id));
    }
    justRemovedRef.current = id;
    setTimeout(() => {
      if (justRemovedRef.current === id) justRemovedRef.current = null;
    }, 100);
  };

  const setActiveCollection = async (collection: CollectionSummary) => {
    await mutateActiveCollection({ collectionId: collection._id, isActive: true });
  };

  const setActiveDeck = async (deck: DeckSummary) => {
    await mutateActiveDeck({ deckId: deck._id, isActive: true });
  };

  const setActiveEntity = (entity: OpenEntitySummary) => {
    if (entity.kind === "collection") setActiveCollection(entity);
    else setActiveDeck(entity);
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
        setActiveCollection,
        activeDeck,
        setActiveDeck,
        setActiveEntity
      }}
    >
      {children}
    </OpenEntitiesContext.Provider>
  );
}

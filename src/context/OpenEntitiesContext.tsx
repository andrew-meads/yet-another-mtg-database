"use client";

import { useUpdateActiveCollection } from "@/hooks/react-query/useUpdateActiveCollection";
import { useUpdateActiveDeck } from "@/hooks/react-query/useUpdateActiveDeck";
import { useRetrieveCollectionSummaries } from "@/hooks/react-query/useRetrieveCollectionSummaries";
import { useRetrieveDeckSummaries } from "@/hooks/react-query/useRetrieveDeckSummaries";
import { CollectionSummary } from "@/types/Collection";
import { DeckSummary, OpenEntitySummary } from "@/types/Deck";
import { PinnedEntityRef, UserSettingsPayload } from "@/types/UserSettings";
import { createContext, useContext, useEffect, useMemo } from "react";
import { useServerSetting } from "@/hooks/useServerSetting";

interface OpenEntitiesContextType {
  /**
   * Collections and decks pinned to the app bar, where they render inline as drop
   * targets. The active collection and active deck are always included (first).
   */
  pinnedEntities: OpenEntitySummary[];
  /** Every other collection and deck. These live behind the "More" menu. */
  unpinnedEntities: OpenEntitySummary[];
  /** Whether an entity is pinned (explicitly, or because it is active). */
  isPinned: (id: string) => boolean;
  pinEntity: (entity: OpenEntitySummary) => void;
  /** Unpin an entity. No-op for the active collection/deck. */
  unpinEntity: (id: string) => void;
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

/** Stable empty list so the pre-hydration fallback doesn't churn identities. */
const NO_PINNED_REFS: PinnedEntityRef[] = [];

const toRef = (entity: OpenEntitySummary): PinnedEntityRef => ({
  id: entity._id,
  kind: entity.kind
});

/**
 * Merge the server's pinned list with entities pinned locally while the settings
 * request was still in flight. Server order first, then local additions.
 */
function reconcilePinnedRefs(
  server: PinnedEntityRef[],
  local: PinnedEntityRef[]
): PinnedEntityRef[] {
  const seen = new Set(server.map((ref) => ref.id));
  return [...server, ...local.filter((ref) => !seen.has(ref.id))];
}

/**
 * Seed the pinned list from the legacy `openEntities` section: only the entries
 * that were pinned survive (merely "open" entities no longer exist as a state).
 */
function migrateLegacyOpenEntities(settings: UserSettingsPayload): PinnedEntityRef[] | undefined {
  return settings.openEntities
    ?.filter((ref) => ref.pinned === true)
    .map(({ id, kind }) => ({ id, kind }));
}

/**
 * Tracks which collections and decks are pinned to the app bar. Stores only
 * { id, kind } refs — synced to the user's server-side settings — and derives
 * the full summaries from the cached collection + deck summary queries. The
 * active collection and active deck are pinned automatically and persistently,
 * so they stay pinned after something else becomes active.
 */
export function OpenEntitiesProvider({ children }: { children: React.ReactNode }) {
  const [pinnedRefs, setPinnedRefs, { hydrated }] = useServerSetting<PinnedEntityRef[]>(
    "pinnedEntities",
    NO_PINNED_REFS,
    { migrate: migrateLegacyOpenEntities, reconcile: reconcilePinnedRefs }
  );
  const { mutateAsync: mutateActiveCollection } = useUpdateActiveCollection();
  const { mutateAsync: mutateActiveDeck } = useUpdateActiveDeck();

  const { data: collectionsData } = useRetrieveCollectionSummaries();
  const { data: decksData } = useRetrieveDeckSummaries();
  const collections = useMemo(() => collectionsData?.collections ?? [], [collectionsData]);
  const decks = useMemo(() => decksData?.decks ?? [], [decksData]);

  const activeCollection = collections.find((c) => c.isActive) ?? null;
  const activeDeck = decks.find((d) => d.isActive) ?? null;

  // Persist a pin for each active entity, so it stays pinned once it stops being
  // active. Until the write lands (or before hydration) it is pinned implicitly.
  useEffect(() => {
    if (!hydrated) return;
    const missing = [activeCollection, activeDeck].filter(
      (e): e is NonNullable<typeof e> => e !== null && !pinnedRefs.some((ref) => ref.id === e._id)
    );
    if (missing.length === 0) return;
    setPinnedRefs((prev) => [
      ...prev,
      ...missing.filter((e) => !prev.some((ref) => ref.id === e._id)).map(toRef)
    ]);
  }, [hydrated, activeCollection, activeDeck, pinnedRefs, setPinnedRefs]);

  const isActiveId = (id: string) => activeCollection?._id === id || activeDeck?._id === id;

  const isPinned = (id: string) => isActiveId(id) || pinnedRefs.some((ref) => ref.id === id);

  const { pinnedEntities, unpinnedEntities } = useMemo(() => {
    const pinnedIds = new Set(pinnedRefs.map((ref) => ref.id));
    const all: OpenEntitySummary[] = [...collections, ...decks];
    const effectivelyPinned = (e: OpenEntitySummary) => e.isActive === true || pinnedIds.has(e._id);

    // Pinned strip: active collection, then active deck, then pin order. Refs to
    // deleted entities simply don't resolve.
    const byId = new Map(all.map((e) => [e._id, e]));
    const explicit = pinnedRefs
      .map((ref) => byId.get(ref.id))
      .filter((e): e is OpenEntitySummary => e !== undefined && e.isActive !== true);
    const active = [collections.find((c) => c.isActive), decks.find((d) => d.isActive)].filter(
      (e): e is NonNullable<typeof e> => e !== undefined
    );

    return {
      pinnedEntities: [...active, ...explicit],
      unpinnedEntities: all.filter((e) => !effectivelyPinned(e))
    };
  }, [pinnedRefs, collections, decks]);

  const pinEntity = (entity: OpenEntitySummary) => {
    setPinnedRefs((prev) =>
      prev.some((ref) => ref.id === entity._id) ? prev : [...prev, toRef(entity)]
    );
  };

  const unpinEntity = (id: string) => {
    // Active entities are always pinned.
    if (isActiveId(id)) return;
    setPinnedRefs((prev) => prev.filter((ref) => ref.id !== id));
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
        pinnedEntities,
        unpinnedEntities,
        isPinned,
        pinEntity,
        unpinEntity,
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

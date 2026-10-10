import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";

const h = vi.hoisted(() => {
  const defaults = () => ({
    collections: [
      { _id: "c1", name: "Main", kind: "collection", isActive: true, owner: "o" },
      { _id: "c2", name: "Binder", kind: "collection", isActive: false, owner: "o" }
    ] as any[],
    decks: [{ _id: "d1", name: "Burn", kind: "deck", owner: "o" }] as any[]
  });
  return {
    mutateActive: vi.fn(),
    mutateActiveDeck: vi.fn(),
    defaults,
    state: defaults(),
    /** Pre-seeded pinned refs (stands in for the server-stored value). */
    seedRefs: [] as any[],
    /** Every value the context persisted through the (faked) server setting. */
    writes: [] as any[],
    /** The section + options the context passed to useServerSetting. */
    serverSettingCall: null as null | { section: string; options: any }
  };
});

// The server-sync mechanics are covered by useServerSetting's own tests; fake it
// with plain state here so these tests focus on the context logic.
vi.mock("@/hooks/useServerSetting", () => ({
  useServerSetting: (section: string, initial: unknown, options?: unknown) => {
    h.serverSettingCall = { section, options };
    const [value, setValue] = React.useState(h.seedRefs.length > 0 ? h.seedRefs : initial);
    const set = (next: unknown | ((prev: unknown) => unknown)) => {
      setValue((prev: unknown) => {
        const resolved = next instanceof Function ? next(prev) : next;
        h.writes.push(resolved);
        return resolved;
      });
    };
    return [value, set, { hydrated: true }];
  }
}));

vi.mock("@/hooks/react-query/useUpdateActiveCollection", () => ({
  useUpdateActiveCollection: () => ({ mutateAsync: h.mutateActive })
}));
vi.mock("@/hooks/react-query/useUpdateActiveDeck", () => ({
  useUpdateActiveDeck: () => ({ mutateAsync: h.mutateActiveDeck })
}));
vi.mock("@/hooks/react-query/useRetrieveCollectionSummaries", () => ({
  useRetrieveCollectionSummaries: () => ({ data: { collections: h.state.collections } })
}));
vi.mock("@/hooks/react-query/useRetrieveDeckSummaries", () => ({
  useRetrieveDeckSummaries: () => ({ data: { decks: h.state.decks } })
}));

import { OpenEntitiesProvider, useOpenEntitiesContext } from "@/context/OpenEntitiesContext";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(OpenEntitiesProvider, null, children);

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  h.state = h.defaults();
  h.seedRefs = [];
  h.writes = [];
  h.serverSettingCall = null;
});

describe("OpenEntitiesContext", () => {
  it("throws when used outside a provider", () => {
    expect(() => renderHook(() => useOpenEntitiesContext())).toThrow(/OpenEntitiesProvider/);
  });

  it("stores pins in the pinnedEntities server setting", () => {
    renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(h.serverSettingCall?.section).toBe("pinnedEntities");
  });

  it("derives the active collection from the summaries", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.activeCollection?._id).toBe("c1");
  });

  it("lists every non-pinned collection and deck as unpinned", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    // c1 is active (so pinned); everything else is unpinned, collections first.
    expect(result.current.unpinnedEntities.map((e) => e._id)).toEqual(["c2", "d1"]);
  });

  it("persists a pin for the active collection once hydrated", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(h.writes.at(-1)).toEqual([{ id: "c1", kind: "collection" }]);
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["c1"]);
  });

  it("pins an entity, derives its full summary, and persists the ref", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });

    act(() => result.current.pinEntity({ _id: "d1", kind: "deck" } as any));
    expect(result.current.isPinned("d1")).toBe(true);
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["c1", "d1"]);
    expect(result.current.pinnedEntities[1].name).toBe("Burn");
    expect(result.current.unpinnedEntities.map((e) => e._id)).toEqual(["c2"]);
    expect(h.writes.at(-1)).toEqual([
      { id: "c1", kind: "collection" },
      { id: "d1", kind: "deck" }
    ]);
  });

  it("does not pin the same entity twice", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.pinEntity({ _id: "c2", kind: "collection" } as any));
    act(() => result.current.pinEntity({ _id: "c2", kind: "collection" } as any));
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["c1", "c2"]);
  });

  it("unpins an entity back into the unpinned list", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.pinEntity({ _id: "c2", kind: "collection" } as any));
    act(() => result.current.unpinEntity("c2"));
    expect(result.current.isPinned("c2")).toBe(false);
    expect(result.current.unpinnedEntities.map((e) => e._id)).toEqual(["c2", "d1"]);
  });

  it("keeps a collection's persisted search string when it is unpinned", () => {
    window.localStorage.setItem("collection-search-c2", JSON.stringify("t:creature"));
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.pinEntity({ _id: "c2", kind: "collection" } as any));
    act(() => result.current.unpinEntity("c2"));
    expect(window.localStorage.getItem("collection-search-c2")).not.toBeNull();
  });

  it("ignores refs that no longer exist in the summaries", () => {
    h.seedRefs = [{ id: "ghost", kind: "collection" }];
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["c1"]);
  });

  it("honors a pre-seeded pinned ref on mount", () => {
    h.seedRefs = [{ id: "d1", kind: "deck" }];
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.isPinned("d1")).toBe(true);
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["c1", "d1"]);
  });

  it("treats the active collection as always pinned and refuses to unpin it", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.isPinned("c1")).toBe(true);

    act(() => result.current.unpinEntity("c1"));
    expect(result.current.isPinned("c1")).toBe(true);
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["c1"]);
  });

  it("treats the active deck as always pinned and refuses to unpin it", () => {
    h.state.decks = [{ _id: "d1", name: "Burn", kind: "deck", isActive: true, owner: "o" }];
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.isPinned("d1")).toBe(true);

    act(() => result.current.unpinEntity("d1"));
    expect(result.current.isPinned("d1")).toBe(true);
    expect(result.current.unpinnedEntities.map((e) => e._id)).toEqual(["c2"]);
  });

  it("keeps the previously active collection pinned (and now unpinnable) after another becomes active", () => {
    const { result, rerender } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.isPinned("c1")).toBe(true);

    // c2 becomes active (as the summaries refetch would report).
    h.state.collections = [
      { _id: "c1", name: "Main", kind: "collection", isActive: false, owner: "o" },
      { _id: "c2", name: "Binder", kind: "collection", isActive: true, owner: "o" }
    ];
    rerender();

    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["c2", "c1"]);
    expect(h.writes.at(-1)).toEqual([
      { id: "c1", kind: "collection" },
      { id: "c2", kind: "collection" }
    ]);

    act(() => result.current.unpinEntity("c1"));
    expect(result.current.isPinned("c1")).toBe(false);
    expect(result.current.unpinnedEntities.map((e) => e._id)).toEqual(["c1", "d1"]);
  });

  it("sorts the active collection, then the active deck, ahead of other pins", () => {
    h.state.decks = [{ _id: "d1", name: "Burn", kind: "deck", isActive: true, owner: "o" }];
    h.seedRefs = [
      { id: "c2", kind: "collection" },
      { id: "d1", kind: "deck" },
      { id: "c1", kind: "collection" }
    ];
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["c1", "d1", "c2"]);
  });

  it("migrates only the pinned entries of the legacy openEntities section", () => {
    renderHook(() => useOpenEntitiesContext(), { wrapper });
    const migrate = h.serverSettingCall?.options?.migrate;
    expect(
      migrate({
        openEntities: [
          { id: "c1", kind: "collection" },
          { id: "c2", kind: "collection", pinned: true },
          { id: "d1", kind: "deck", pinned: false }
        ]
      })
    ).toEqual([{ id: "c2", kind: "collection" }]);
    expect(migrate({})).toBeUndefined();
  });

  it("delegates setActiveCollection to the mutation", async () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    await act(async () => {
      await result.current.setActiveCollection({ _id: "c2" } as any);
    });
    expect(h.mutateActive).toHaveBeenCalledWith({ collectionId: "c2", isActive: true });
  });

  it("derives the active deck from the summaries, independently of the active collection", () => {
    h.state.decks = [
      { _id: "d1", name: "Burn", kind: "deck", isActive: false, owner: "o" },
      { _id: "d2", name: "Elves", kind: "deck", isActive: true, owner: "o" }
    ];
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });

    // A collection and a deck are active at the same time.
    expect(result.current.activeCollection?._id).toBe("c1");
    expect(result.current.activeDeck?._id).toBe("d2");
  });

  it("reports a null active deck when no deck is active", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.activeDeck).toBeNull();
  });

  it("delegates setActiveDeck to the deck mutation", async () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    await act(async () => {
      await result.current.setActiveDeck({ _id: "d1" } as any);
    });
    expect(h.mutateActiveDeck).toHaveBeenCalledWith({ deckId: "d1", isActive: true });
    expect(h.mutateActive).not.toHaveBeenCalled();
  });

  it("setActiveEntity dispatches on the entity kind", async () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });

    await act(async () => result.current.setActiveEntity({ _id: "d1", kind: "deck" } as any));
    expect(h.mutateActiveDeck).toHaveBeenCalledWith({ deckId: "d1", isActive: true });

    await act(async () => result.current.setActiveEntity({ _id: "c2", kind: "collection" } as any));
    expect(h.mutateActive).toHaveBeenCalledWith({ collectionId: "c2", isActive: true });
  });
});

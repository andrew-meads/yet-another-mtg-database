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
    /** Pre-seeded open refs (stands in for the server-stored value). */
    seedRefs: [] as any[],
    /** Every value the context persisted through the (faked) server setting. */
    writes: [] as any[]
  };
});

// The server-sync mechanics are covered by useServerSetting's own tests; fake it
// with plain state here so these tests focus on the context logic.
vi.mock("@/hooks/useServerSetting", () => ({
  useServerSetting: (_section: string, initial: unknown) => {
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
});

describe("OpenEntitiesContext", () => {
  it("throws when used outside a provider", () => {
    expect(() => renderHook(() => useOpenEntitiesContext())).toThrow(/OpenEntitiesProvider/);
  });

  it("derives the active collection from the summaries", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.activeCollection?._id).toBe("c1");
  });

  it("opens an entity, derives its full summary, and persists the ref", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });

    act(() => result.current.addOpenEntity({ _id: "d1", kind: "deck" } as any));
    expect(result.current.openEntities.map((e) => e._id)).toEqual(["d1"]);
    expect(result.current.openEntities[0].name).toBe("Burn");
    expect(h.writes.at(-1)).toEqual([{ id: "d1", kind: "deck" }]);
  });

  it("does not open the same entity twice", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.addOpenEntity({ _id: "c2", kind: "collection" } as any));
    act(() => result.current.addOpenEntity({ _id: "c2", kind: "collection" } as any));
    expect(result.current.openEntities).toHaveLength(1);
  });

  it("ignores refs that no longer exist in the summaries", () => {
    h.seedRefs = [{ id: "ghost", kind: "collection" }];
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.openEntities).toHaveLength(0);
  });

  it("removes an open entity", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.addOpenEntity({ _id: "c2", kind: "collection" } as any));
    act(() => result.current.removeOpenEntity("c2"));
    expect(result.current.openEntities).toHaveLength(0);
  });

  it("clears the collection's persisted search string on close", () => {
    window.localStorage.setItem("collection-search-c2", JSON.stringify("t:creature"));
    window.localStorage.setItem("collection-search-other", JSON.stringify("t:land"));

    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.addOpenEntity({ _id: "c2", kind: "collection" } as any));
    act(() => result.current.removeOpenEntity("c2"));

    expect(window.localStorage.getItem("collection-search-c2")).toBeNull();
    // Other collections' searches are untouched.
    expect(window.localStorage.getItem("collection-search-other")).not.toBeNull();
  });

  it("delegates setActiveCollection to the mutation", async () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    await act(async () => {
      await result.current.setActiveCollection({ _id: "c2" } as any);
    });
    expect(h.mutateActive).toHaveBeenCalledWith({ collectionId: "c2", isActive: true });
  });

  it("togglePin flips the pinned flag and persists it", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.addOpenEntity({ _id: "d1", kind: "deck" } as any));

    expect(result.current.isPinned("d1")).toBe(false);
    act(() => result.current.togglePin("d1"));

    expect(result.current.isPinned("d1")).toBe(true);
    expect(h.writes.at(-1)).toEqual([{ id: "d1", kind: "deck", pinned: true }]);

    act(() => result.current.togglePin("d1"));
    expect(result.current.isPinned("d1")).toBe(false);
  });

  it("partitions open entities into pinned and unpinned", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.addOpenEntity({ _id: "c2", kind: "collection" } as any));
    act(() => result.current.addOpenEntity({ _id: "d1", kind: "deck" } as any));

    // Nothing pinned yet, and neither is the active collection.
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual([]);
    expect(result.current.unpinnedEntities.map((e) => e._id)).toEqual(["c2", "d1"]);

    act(() => result.current.togglePin("d1"));
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["d1"]);
    expect(result.current.unpinnedEntities.map((e) => e._id)).toEqual(["c2"]);
  });

  it("treats the active collection as always pinned and refuses to unpin it", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    // c1 is the active collection per the hoisted state.
    act(() => result.current.addOpenEntity({ _id: "c1", kind: "collection" } as any));

    expect(result.current.isPinned("c1")).toBe(true);
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["c1"]);

    act(() => result.current.togglePin("c1"));
    expect(result.current.isPinned("c1")).toBe(true);
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

  it("treats the active deck as always pinned and refuses to unpin it", () => {
    h.state.decks = [{ _id: "d1", name: "Burn", kind: "deck", isActive: true, owner: "o" }];
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.addOpenEntity({ _id: "d1", kind: "deck" } as any));

    expect(result.current.isPinned("d1")).toBe(true);
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["d1"]);

    act(() => result.current.togglePin("d1"));
    expect(result.current.isPinned("d1")).toBe(true);
  });

  it("sorts the active collection ahead of the active deck in the pinned strip", () => {
    h.state.decks = [{ _id: "d1", name: "Burn", kind: "deck", isActive: true, owner: "o" }];
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.addOpenEntity({ _id: "d1", kind: "deck" } as any));
    act(() => result.current.addOpenEntity({ _id: "c2", kind: "collection" } as any));
    act(() => result.current.addOpenEntity({ _id: "c1", kind: "collection" } as any));
    act(() => result.current.togglePin("c2"));

    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["c1", "d1", "c2"]);
  });

  it("honors a pre-seeded pinned ref on mount", () => {
    h.seedRefs = [{ id: "d1", kind: "deck", pinned: true }];
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.isPinned("d1")).toBe(true);
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["d1"]);
  });
});

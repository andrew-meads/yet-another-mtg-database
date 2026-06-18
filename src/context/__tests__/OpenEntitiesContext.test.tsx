import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  mutateActive: vi.fn(),
  state: {
    collections: [
      { _id: "c1", name: "Main", kind: "collection", isActive: true, owner: "o" },
      { _id: "c2", name: "Binder", kind: "collection", isActive: false, owner: "o" }
    ] as any[],
    decks: [{ _id: "d1", name: "Burn", kind: "deck", owner: "o" }] as any[]
  }
}));

vi.mock("@/hooks/react-query/useUpdateActiveCollection", () => ({
  useUpdateActiveCollection: () => ({ mutateAsync: h.mutateActive })
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
    expect(JSON.parse(window.localStorage.getItem("open-entity-ids")!)).toEqual([
      { id: "d1", kind: "deck" }
    ]);
  });

  it("does not open the same entity twice", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.addOpenEntity({ _id: "c2", kind: "collection" } as any));
    act(() => result.current.addOpenEntity({ _id: "c2", kind: "collection" } as any));
    expect(result.current.openEntities).toHaveLength(1);
  });

  it("ignores refs that no longer exist in the summaries", () => {
    window.localStorage.setItem(
      "open-entity-ids",
      JSON.stringify([{ id: "ghost", kind: "collection" }])
    );
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.openEntities).toHaveLength(0);
  });

  it("removes an open entity", () => {
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    act(() => result.current.addOpenEntity({ _id: "c2", kind: "collection" } as any));
    act(() => result.current.removeOpenEntity("c2"));
    expect(result.current.openEntities).toHaveLength(0);
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
    expect(JSON.parse(window.localStorage.getItem("open-entity-ids")!)).toEqual([
      { id: "d1", kind: "deck", pinned: true }
    ]);

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

  it("honors a pre-seeded pinned ref on mount", () => {
    window.localStorage.setItem(
      "open-entity-ids",
      JSON.stringify([{ id: "d1", kind: "deck", pinned: true }])
    );
    const { result } = renderHook(() => useOpenEntitiesContext(), { wrapper });
    expect(result.current.isPinned("d1")).toBe(true);
    expect(result.current.pinnedEntities.map((e) => e._id)).toEqual(["d1"]);
  });
});

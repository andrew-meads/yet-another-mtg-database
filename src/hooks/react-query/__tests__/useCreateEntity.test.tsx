import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ pinEntity: vi.fn() }));

vi.mock("@/context/OpenEntitiesContext", () => ({
  useOpenEntitiesContext: () => ({ pinEntity: h.pinEntity })
}));

import { useCreateCollection } from "@/hooks/react-query/useCreateCollection";
import { useCreateDeck } from "@/hooks/react-query/useCreateDeck";

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "TestQueryWrapper";
  return Wrapper;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

let fetchMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.spyOn(globalThis, "fetch");
});

afterEach(() => fetchMock.mockRestore());

describe("useCreateCollection", () => {
  it("POSTs the collection, pins it, and invalidates the summaries", async () => {
    // The API response carries no `kind`; the hook supplies it.
    fetchMock.mockResolvedValue(jsonResponse({ collection: { _id: "c-new", name: "Binder" } }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateCollection(), { wrapper: wrapper(client) });

    await result.current.mutateAsync({ name: "Binder", description: "" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/collections");
    expect(init).toMatchObject({ method: "POST" });
    await waitFor(() =>
      expect(h.pinEntity).toHaveBeenCalledWith({ _id: "c-new", kind: "collection" })
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["collection-summaries"] });
  });

  it("does not pin anything when creation fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Name is required" }, 400));
    const client = new QueryClient();
    const { result } = renderHook(() => useCreateCollection(), { wrapper: wrapper(client) });

    await expect(result.current.mutateAsync({ name: "", description: "" })).rejects.toThrow(
      "Name is required"
    );
    expect(h.pinEntity).not.toHaveBeenCalled();
  });
});

describe("useCreateDeck", () => {
  it("POSTs the deck, pins it, and invalidates the summaries", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deck: { _id: "d-new", name: "Burn" } }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateDeck(), { wrapper: wrapper(client) });

    await result.current.mutateAsync({ name: "Burn", description: "" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/decks");
    expect(init).toMatchObject({ method: "POST" });
    await waitFor(() => expect(h.pinEntity).toHaveBeenCalledWith({ _id: "d-new", kind: "deck" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deck-summaries"] });
  });

  it("does not pin anything when creation fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Name is required" }, 400));
    const client = new QueryClient();
    const { result } = renderHook(() => useCreateDeck(), { wrapper: wrapper(client) });

    await expect(result.current.mutateAsync({ name: "", description: "" })).rejects.toThrow(
      "Name is required"
    );
    expect(h.pinEntity).not.toHaveBeenCalled();
  });
});

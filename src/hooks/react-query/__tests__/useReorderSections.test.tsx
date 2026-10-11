import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useReorderSections } from "@/hooks/react-query/useDeckSections";
import type { DeckDetailsResponse } from "@/hooks/react-query/useRetrieveDeckDetails";

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "TestQueryWrapper";
  return Wrapper;
}

function deckDetails(sectionIds: string[]): DeckDetailsResponse {
  return {
    deck: {
      _id: "deck-1",
      name: "Deck",
      description: "",
      kind: "deck",
      owner: "u1",
      sections: sectionIds.map((id) => ({ _id: id, name: id, columns: [] }))
    }
  };
}

const sectionOrder = (client: QueryClient) =>
  client
    .getQueryData<DeckDetailsResponse>(["deck-details", "deck-1"])!
    .deck.sections.map((s) => s._id);

let fetchMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
});

afterEach(() => fetchMock.mockRestore());

describe("useReorderSections", () => {
  it("PATCHes the order and reorders the cached deck before the response", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const client = new QueryClient();
    client.setQueryData(["deck-details", "deck-1"], deckDetails(["a", "b", "c"]));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useReorderSections(), { wrapper: wrapper(client) });

    result.current.mutate({ deckId: "deck-1", order: ["c", "a", "b"] });

    await waitFor(() => expect(sectionOrder(client)).toEqual(["c", "a", "b"]));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/decks/deck-1/sections");
    expect(init).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(init!.body as string)).toEqual({ order: ["c", "a", "b"] });

    resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deck-details", "deck-1"] })
    );
  });

  it("restores the previous order when the server refuses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "stale order" }), { status: 409 })
    );
    const client = new QueryClient();
    client.setQueryData(["deck-details", "deck-1"], deckDetails(["a", "b", "c"]));
    const { result } = renderHook(() => useReorderSections(), { wrapper: wrapper(client) });

    await expect(
      result.current.mutateAsync({ deckId: "deck-1", order: ["c", "a", "b"] })
    ).rejects.toThrow("stale order");
    expect(sectionOrder(client)).toEqual(["a", "b", "c"]);
  });
});

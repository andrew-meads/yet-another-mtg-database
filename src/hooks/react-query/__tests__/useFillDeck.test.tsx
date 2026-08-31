import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFillDeck } from "@/hooks/react-query/useFillDeck";

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "TestQueryWrapper";
  return Wrapper;
}

let fetchMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, filled: 2 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
});

afterEach(() => fetchMock.mockRestore());

describe("useFillDeck", () => {
  it("POSTs the swaps to the fill endpoint and invalidates membership queries", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useFillDeck(), { wrapper: wrapper(client) });

    const swaps = [
      { ephemeralId: "e1", physicalCardId: "r1" },
      { ephemeralId: "e2", physicalCardId: "r2" }
    ];
    const response = await result.current.mutateAsync({ deckId: "deck-1", swaps });
    expect(response).toEqual({ ok: true, filled: 2 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/decks/deck-1/fill");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ swaps });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["collection-details"] })
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deck-details"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["card-locations"] });
  });

  it("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid swaps" }), { status: 400 })
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useFillDeck(), { wrapper: wrapper(client) });

    await expect(
      result.current.mutateAsync({ deckId: "deck-1", swaps: [] })
    ).rejects.toThrow("Invalid swaps");
  });
});

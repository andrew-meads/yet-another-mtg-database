import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useArchiveDeck } from "@/hooks/react-query/useArchiveDeck";

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "TestQueryWrapper";
  return Wrapper;
}

let fetchMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, archived: 3 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
});

afterEach(() => fetchMock.mockRestore());

describe("useArchiveDeck", () => {
  it("POSTs to the archive endpoint and invalidates membership queries on success", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useArchiveDeck(), { wrapper: wrapper(client) });

    const response = await result.current.mutateAsync("deck-1");
    expect(response).toEqual({ ok: true, archived: 3 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/decks/deck-1/archive");
    expect(init).toMatchObject({ method: "POST" });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["collection-details"] })
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deck-details"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["card-locations"] });
  });

  it("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Deck not found" }), { status: 404 })
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useArchiveDeck(), { wrapper: wrapper(client) });

    await expect(result.current.mutateAsync("deck-1")).rejects.toThrow("Deck not found");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCreatePhysicalCard } from "@/hooks/react-query/useCreatePhysicalCard";

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "TestQueryWrapper";
  return Wrapper;
}

let fetchMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ physicalCardIds: ["new-1"] }), {
      status: 201,
      headers: { "content-type": "application/json" }
    })
  );
});

afterEach(() => fetchMock.mockRestore());

describe("useCreatePhysicalCard", () => {
  it("POSTs to /api/physical-cards and invalidates membership queries on success", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreatePhysicalCard(), { wrapper: wrapper(client) });

    await result.current.mutateAsync({ cardId: "card-1", collectionId: "c1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/physical-cards");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      cardId: "card-1",
      collectionId: "c1"
    });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["collection-details"] })
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deck-details"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["card-locations"] });
    // No tags supplied -> the tags query is not invalidated.
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["tags"] });
  });

  it("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "nope" }), { status: 500 })
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useCreatePhysicalCard(), { wrapper: wrapper(client) });

    await expect(result.current.mutateAsync({ cardId: "x", collectionId: "y" })).rejects.toThrow(
      "nope"
    );
  });
});

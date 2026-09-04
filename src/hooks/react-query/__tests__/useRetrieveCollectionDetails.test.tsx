import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, isNotFoundError } from "@/lib/apiError";
import { useRetrieveCollectionDetails } from "@/hooks/react-query/useRetrieveCollectionDetails";

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "TestQueryWrapper";
  return Wrapper;
}

const slimCard = {
  id: "card-a",
  name: "Shock",
  layout: "normal",
  cmc: 1,
  type_line: "Instant",
  set: "tst",
  set_name: "Test Set",
  collector_number: "1",
  rarity: "common"
};

const wireResponse = {
  collection: {
    _id: "coll-1",
    name: "Main",
    description: "",
    isActive: true,
    owner: "user-1",
    kind: "collection",
    cards: [
      { _id: "pc-1", cardId: "card-a", collectionId: "coll-1", deckId: null },
      { _id: "pc-2", cardId: "card-a", collectionId: "coll-1", deckId: null }
    ]
  },
  cardData: { "card-a": slimCard }
};

let fetchMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(wireResponse), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
});

afterEach(() => fetchMock.mockRestore());

describe("useRetrieveCollectionDetails", () => {
  it("re-joins wire entries with the cardData map into DetailedPhysicalCards", async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useRetrieveCollectionDetails("coll-1"), {
      wrapper: wrapper(client)
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/collections/coll-1?details=true");

    const cards = result.current.data!.collection.cards;
    expect(cards).toHaveLength(2);
    expect(cards[0].card.name).toBe("Shock");
    // Copies of the same card share one card object (the dedup survives the join).
    expect(cards[0].card).toBe(cards[1].card);
  });

  it("passes the q param through and trims it", async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useRetrieveCollectionDetails("coll-1", "  t:instant "), {
      wrapper: wrapper(client)
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/collections/coll-1?details=true&q=t%3Ainstant");
  });

  it("throws the server error message on a non-ok response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Collection not found" }), { status: 404 })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRetrieveCollectionDetails("coll-1"), {
      wrapper: wrapper(client)
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error!.message).toBe("Collection not found");
  });
});

describe("useRetrieveCollectionDetails 404 handling", () => {
  it("surfaces a 404 as an ApiError without retrying", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      })
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useRetrieveCollectionDetails("missing"), {
      wrapper: wrapper(client)
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(404);
    expect(isNotFoundError(result.current.error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

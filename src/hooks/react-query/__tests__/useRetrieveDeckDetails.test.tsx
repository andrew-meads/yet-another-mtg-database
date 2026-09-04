import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, isNotFoundError } from "@/lib/apiError";
import { useRetrieveDeckDetails } from "@/hooks/react-query/useRetrieveDeckDetails";

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
  deck: {
    _id: "deck-1",
    name: "Burn",
    description: "",
    isActive: false,
    owner: "user-1",
    kind: "deck",
    sections: [
      {
        _id: "sec-1",
        name: "Main",
        columns: [
          {
            _id: "col-1",
            cards: [
              {
                _id: "pc-1",
                cardId: "card-a",
                collectionId: "coll-1",
                deckId: "deck-1",
                collectionName: "Main"
              },
              {
                _id: "pc-2",
                cardId: "card-a",
                collectionId: null,
                deckId: "deck-1",
                isEphemeral: true
              }
            ]
          }
        ]
      }
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

describe("useRetrieveDeckDetails", () => {
  it("re-joins entries in every section/column with the cardData map", async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useRetrieveDeckDetails("deck-1"), {
      wrapper: wrapper(client)
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/decks/deck-1?details=true");

    const cards = result.current.data!.deck.sections[0].columns[0].cards;
    expect(cards).toHaveLength(2);
    expect(cards[0].card.name).toBe("Shock");
    expect(cards[0].card).toBe(cards[1].card);
    // Entry-level fields survive the join untouched.
    expect(cards[0].collectionName).toBe("Main");
    expect(cards[1].isEphemeral).toBe(true);
  });

  it("throws the server error message on a non-ok response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Deck not found" }), { status: 404 })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRetrieveDeckDetails("deck-1"), {
      wrapper: wrapper(client)
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error!.message).toBe("Deck not found");
  });
});

describe("useRetrieveDeckDetails 404 handling", () => {
  it("surfaces a 404 as an ApiError without retrying", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      })
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useRetrieveDeckDetails("missing"), {
      wrapper: wrapper(client)
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(404);
    expect(isNotFoundError(result.current.error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

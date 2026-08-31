import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCardLocations } from "@/hooks/react-query/useCardLocations";

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
  locations: [
    {
      collectionId: "coll-1",
      collectionName: "Main",
      cards: [{ _id: "pc-1", cardId: "card-a", collectionId: "coll-1", deckId: null }]
    }
  ],
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

describe("useCardLocations", () => {
  it("re-joins each location's entries with the cardData map", async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useCardLocations("Shock"), {
      wrapper: wrapper(client)
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cards/locations?name=Shock");

    const { locations } = result.current.data!;
    expect(locations).toHaveLength(1);
    expect(locations[0].cards[0].card.name).toBe("Shock");
  });
});

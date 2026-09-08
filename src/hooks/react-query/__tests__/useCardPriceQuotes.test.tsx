import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  PRICE_REQUEST_CHUNK,
  fetchPriceQuotes,
  quoteForCard,
  useCardPriceQuotes
} from "@/hooks/react-query/useCardPriceQuotes";

const prices = {
  usd: "1.00",
  usd_foil: null,
  usd_etched: null,
  eur: null,
  eur_foil: null,
  tix: null
};

function priceResponse(ids: string[]) {
  return Response.json({
    prices: Object.fromEntries(ids.map((id) => [id, prices])),
    updatedAt: Object.fromEntries(ids.map((id) => [id, "2026-09-08T00:00:00.000Z"]))
  });
}

let fetchMock: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => fetchMock?.mockRestore());

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("fetchPriceQuotes", () => {
  it("posts ids in chunks of 500 and merges the quotes", async () => {
    const ids = Array.from({ length: PRICE_REQUEST_CHUNK + 1 }, (_, i) => `c${i}`);
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { ids: string[] };
      return priceResponse(body.ids);
    });
    const quotes = await fetchPriceQuotes(ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(quotes)).toHaveLength(ids.length);
    expect(quotes.c0).toEqual({ prices, updatedAt: "2026-09-08T00:00:00.000Z" });
  });

  it("throws on a failed request", async () => {
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ error: "nope" }, { status: 502 }));
    await expect(fetchPriceQuotes(["a"])).rejects.toThrow("nope");
  });
});

describe("useCardPriceQuotes", () => {
  it("fetches quotes for the ids (deduplicated, sorted) and exposes them", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { ids: string[] };
      return priceResponse(body.ids);
    });
    const { result } = renderHook(() => useCardPriceQuotes(["b", "a", "b"]), { wrapper });
    await waitFor(() => expect(Object.keys(result.current.quotes)).toHaveLength(2));
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { ids: string[] };
    expect(sent.ids).toEqual(["a", "b"]);
  });

  it("does not fetch when disabled or when there are no ids", () => {
    fetchMock = vi.spyOn(globalThis, "fetch");
    renderHook(() => useCardPriceQuotes(["a"], { enabled: false }), { wrapper });
    renderHook(() => useCardPriceQuotes([]), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("quoteForCard", () => {
  it("prefers the fetched quote, then the card's own prices, then null", () => {
    const fetched = { prices, updatedAt: "2026-09-08T00:00:00.000Z" };
    expect(quoteForCard({ id: "a" }, { a: fetched })).toBe(fetched);
    expect(
      quoteForCard({ id: "b", prices, prices_updated_at: new Date("2026-01-01T00:00:00Z") }, {})
    ).toEqual({ prices, updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(quoteForCard({ id: "c", prices }, {})).toEqual({ prices, updatedAt: null });
    expect(quoteForCard({ id: "d" }, {})).toBeNull();
  });
});

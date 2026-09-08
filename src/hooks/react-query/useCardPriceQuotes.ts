"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CardPriceQuotesResponse, PriceQuote } from "@/types/CardPrice";
import { useMemo } from "react";

/** POST /api/cards/prices accepts at most this many ids per request. */
export const PRICE_REQUEST_CHUNK = 500;

/** Split an array into consecutive chunks of at most `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function fetchPriceQuotes(ids: string[]): Promise<Record<string, PriceQuote>> {
  const quotes: Record<string, PriceQuote> = {};
  for (const batch of chunk(ids, PRICE_REQUEST_CHUNK)) {
    const res = await fetch("/api/cards/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: batch })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Failed to fetch prices" }));
      throw new Error(body.error || `Request failed with status ${res.status}`);
    }
    const data = (await res.json()) as CardPriceQuotesResponse;
    for (const id of batch) {
      if (data.prices[id])
        quotes[id] = { prices: data.prices[id], updatedAt: data.updatedAt[id] ?? null };
    }
  }
  return quotes;
}

/**
 * Up-to-date price quotes for a set of Scryfall ids. The server serves prices
 * stamped within 24h from the card documents and refreshes older ones from
 * Scryfall, so a call both reads and (when needed) refreshes. Ids are sorted and
 * deduplicated for a stable query key; while a new id set loads, the previous
 * result is kept so rows don't flicker. Pass `enabled: false` to hold off (the
 * collection table only asks when its price toggle is on).
 */
export function useCardPriceQuotes(cardIds: string[], options: { enabled?: boolean } = {}) {
  const ids = useMemo(() => [...new Set(cardIds)].sort(), [cardIds]);
  const query = useQuery({
    queryKey: ["card-prices", ids],
    queryFn: () => fetchPriceQuotes(ids),
    enabled: (options.enabled ?? true) && ids.length > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData
  });
  return { quotes: query.data ?? EMPTY_QUOTES, isLoading: query.isLoading, error: query.error };
}

const EMPTY_QUOTES: Record<string, PriceQuote> = {};

/**
 * The best-known quote for a card: the fetched one when present, else the
 * prices/stamp the card document itself carried (search results and slim
 * detail cards both ship them), else nothing.
 */
export function quoteForCard(
  card: { id: string; prices?: PriceQuote["prices"]; prices_updated_at?: Date | string },
  quotes: Record<string, PriceQuote>
): PriceQuote | null {
  const fetched = quotes[card.id];
  if (fetched) return fetched;
  if (card.prices) {
    const stamp = card.prices_updated_at;
    return {
      prices: card.prices,
      updatedAt: stamp ? (stamp instanceof Date ? stamp.toISOString() : String(stamp)) : null
    };
  }
  return null;
}

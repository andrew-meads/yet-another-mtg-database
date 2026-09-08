"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardPriceQuotesResponse, PriceQuote } from "@/types/CardPrice";

async function refreshCardPrices(ids: string[]): Promise<Record<string, PriceQuote>> {
  const res = await fetch("/api/cards/prices/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Failed to refresh prices" }));
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }
  const data = (await res.json()) as CardPriceQuotesResponse;
  const quotes: Record<string, PriceQuote> = {};
  for (const id of ids) {
    if (data.prices[id])
      quotes[id] = { prices: data.prices[id], updatedAt: data.updatedAt[id] ?? null };
  }
  return quotes;
}

/**
 * Force-refresh the prices of one or more cards (ignoring the 24h freshness
 * window). On success: any `["card-prices", …]` request still in flight is
 * cancelled (its response predates the refresh and would overwrite it), the
 * fresh quotes are merged into every cached query so each price tag showing
 * the card updates in place immediately, and the queries are invalidated so
 * they refetch what the server just stored. Failures surface as an error toast.
 */
export function useRefreshCardPrices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refreshCardPrices,
    onSuccess: async (quotes) => {
      await queryClient.cancelQueries({ queryKey: ["card-prices"] });
      queryClient.setQueriesData<Record<string, PriceQuote>>(
        { queryKey: ["card-prices"] },
        (old) => (old ? { ...old, ...quotes } : old)
      );
      await queryClient.invalidateQueries({ queryKey: ["card-prices"] });
    },
    onError: (error) => {
      toast.error(`Couldn't refresh price: ${error.message}`);
    }
  });
}

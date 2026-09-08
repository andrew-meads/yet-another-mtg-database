"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { ExchangeRate } from "@/types/ExchangeRate";
import { BASE_CURRENCY } from "@/lib/pricing";

async function fetchExchangeRate(target: string): Promise<ExchangeRate> {
  const res = await fetch(`/api/exchange-rate?target=${encodeURIComponent(target)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Failed to fetch exchange rate" }));
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

/**
 * The USD → `target` exchange rate (server-cached for 24h; kept for an hour on
 * the client). USD itself never hits the network — the query is disabled and
 * callers should treat the rate as 1.
 */
export function useExchangeRate(target: string): UseQueryResult<ExchangeRate, Error> {
  return useQuery({
    queryKey: ["exchange-rate", target],
    queryFn: () => fetchExchangeRate(target),
    staleTime: 60 * 60 * 1000,
    enabled: target !== BASE_CURRENCY
  });
}

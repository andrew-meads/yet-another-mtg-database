"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CopyPrice } from "@/types/CardPrice";
import { invalidateCardMembership } from "./invalidate";

export interface CopyRefreshResponse {
  prices: Record<string, CopyPrice>;
  unknown: string[];
  /** Proxy copies, skipped: worth $0 by rule. */
  proxies: string[];
}

async function refreshCopyPrices(physicalCardIds: string[]): Promise<CopyRefreshResponse> {
  const res = await fetch("/api/physical-cards/prices/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ physicalCardIds })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Failed to refresh prices" }));
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch prices for specific physical copies according to each one's finish
 * and condition (POST /api/physical-cards/prices/refresh). The records land
 * on the copies, so on success the collection/deck details are invalidated
 * and the rows re-derive their price from the fresh entries. Failures toast.
 */
export function useRefreshCopyPrices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refreshCopyPrices,
    onSuccess: () => invalidateCardMembership(queryClient),
    onError: (error) => {
      toast.error(`Couldn't refresh price: ${error.message}`);
    }
  });
}

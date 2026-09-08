"use client";

import { useCallback } from "react";
import { usePricingSettings } from "@/context/SettingsContext";
import { useExchangeRate } from "@/hooks/react-query/useExchangeRate";
import { BASE_CURRENCY, convertUsd, formatMoney } from "@/lib/pricing";

export interface CurrencyDisplay {
  /** The currency amounts are shown in. Falls back to USD while a rate is loading/unavailable. */
  currency: string;
  /** The user's configured currency (may differ from `currency` while the rate loads). */
  configured: string;
  /** USD → `currency` multiplier (1 for USD). */
  rate: number;
  /** True while a non-USD rate is still loading. */
  loading: boolean;
  /** Format a USD amount in the display currency; null in → null out. */
  format: (usd: number | null | undefined) => string | null;
}

/**
 * The user's display currency resolved to a usable converter: reads the
 * settings section, fetches the USD→currency rate, and degrades to USD (with
 * `currency` reporting "USD") until the rate is available or if it fails, so
 * prices are never hidden by a rate hiccup.
 */
export function useCurrency(): CurrencyDisplay {
  const { pricing } = usePricingSettings();
  const configured = pricing.currency;
  const { data, isLoading } = useExchangeRate(configured);

  const ready = configured === BASE_CURRENCY || (data?.rate !== undefined && data.rate > 0);
  const currency = ready ? configured : BASE_CURRENCY;
  const rate = ready && configured !== BASE_CURRENCY ? data!.rate : 1;

  const format = useCallback(
    (usd: number | null | undefined) =>
      usd === null || usd === undefined ? null : formatMoney(convertUsd(usd, rate), currency),
    [rate, currency]
  );

  return { currency, configured, rate, loading: configured !== BASE_CURRENCY && isLoading, format };
}

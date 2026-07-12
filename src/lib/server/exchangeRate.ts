import { ExchangeRateModel } from "@/db/schema";
import { ExchangeRate } from "@/types/ExchangeRate";

/** Cached rates older than this are refreshed (rates move slowly; daily is plenty). */
export const RATE_STALENESS_MS = 24 * 60 * 60 * 1000;

/** Scryfall prices are USD, so USD is always the conversion base. */
export const BASE_CURRENCY = "USD";

const DEFAULT_RATE_API_BASE_URL = "https://api.frankfurter.dev/v1";

/** ISO 4217 codes are three uppercase letters. */
export function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

/**
 * Read the target rate out of a Frankfurter `/latest` response
 * (`{ base, date, rates: { NZD: 1.63 } }`). Pure — unit-testable.
 * @throws if the target rate is absent (unknown currency).
 */
export function parseFrankfurterResponse(
  json: { rates?: Record<string, number> },
  target: string
): number {
  const rate = json.rates?.[target];
  if (typeof rate !== "number") {
    throw new Error(`Frankfurter response missing rate for ${target}`);
  }
  return rate;
}

/** Whether a cached rate's timestamp is still within the staleness window. */
function isFresh(updatedAt: Date | undefined, now = Date.now()): boolean {
  if (!updatedAt) return false;
  return now - updatedAt.getTime() < RATE_STALENESS_MS;
}

/**
 * Resolve the USD -> target exchange rate. Returns a cached value if fresh
 * (< 24h old), otherwise fetches from Frankfurter (free, no API key) and upserts
 * it. USD -> USD short-circuits to 1 with no network call.
 *
 * @throws if the upstream fetch fails or the target currency is unknown, so the
 * caller can surface a 502.
 */
export async function getExchangeRate(target: string): Promise<ExchangeRate> {
  if (target === BASE_CURRENCY) {
    return { base: BASE_CURRENCY, target, rate: 1, updatedAt: new Date().toISOString() };
  }

  const cached = await ExchangeRateModel.findOne({ base: BASE_CURRENCY, target });
  if (cached && isFresh(cached.updatedAt)) {
    return {
      base: BASE_CURRENCY,
      target,
      rate: cached.rate,
      updatedAt: (cached.updatedAt as Date).toISOString()
    };
  }

  const baseUrl = process.env.EXCHANGE_RATE_API_BASE_URL || DEFAULT_RATE_API_BASE_URL;
  const response = await fetch(`${baseUrl}/latest?base=${BASE_CURRENCY}&symbols=${target}`);
  if (!response.ok) {
    throw new Error(`Exchange-rate API returned ${response.status}`);
  }
  const rate = parseFrankfurterResponse(await response.json(), target);

  const updated = await ExchangeRateModel.findOneAndUpdate(
    { base: BASE_CURRENCY, target },
    { rate },
    { upsert: true, returnDocument: "after" }
  );

  return {
    base: BASE_CURRENCY,
    target,
    rate,
    updatedAt: (updated?.updatedAt as Date | undefined)?.toISOString() ?? new Date().toISOString()
  };
}

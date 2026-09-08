/**
 * Pure, client-safe pricing helpers: picking the right Scryfall price for a
 * copy's finish, currency conversion/formatting, and grading how old a price
 * is. No React, no I/O — unit-tested in src/lib/__tests__/pricing.test.ts.
 */
import { CardPrices } from "@/types/CardPrice";
import { CARD_FINISHES, CardFinish, effectiveFinish } from "@/lib/cardAttributes";

/** Scryfall prices are quoted in USD; everything else is converted client-side. */
export const BASE_CURRENCY = "USD";

/**
 * Currencies the exchange-rate service (Frankfurter, ECB reference rates)
 * supports, offered in the settings picker. USD first, then alphabetical.
 */
export const SUPPORTED_CURRENCIES = [
  "USD",
  "AUD",
  "BGN",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "ISK",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "RON",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "ZAR"
] as const;

export function isSupportedCurrency(code: unknown): code is (typeof SUPPORTED_CURRENCIES)[number] {
  return typeof code === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

/** Which USD price field applies to each finish. */
export const USD_FIELD_BY_FINISH: Record<CardFinish, keyof CardPrices> = {
  nonfoil: "usd",
  foil: "usd_foil",
  etched: "usd_etched"
};

/** Parse a Scryfall decimal-string price; null/blank/garbage → null. */
export function parsePrice(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The USD price of a copy with the given finish (unset finish = non-foil), or null. */
export function usdForFinish(
  prices: CardPrices | null | undefined,
  finish: CardFinish | null | undefined
): number | null {
  if (!prices) return null;
  return parsePrice(prices[USD_FIELD_BY_FINISH[effectiveFinish(finish)]]);
}

/**
 * The most representative USD price of a printing when no specific copy is in
 * view (search results): non-foil if quoted, else foil, else etched — with the
 * finish it came from so the UI can say "foil" when that's all there is.
 */
export function bestUsd(
  prices: CardPrices | null | undefined
): { amount: number; finish: CardFinish } | null {
  for (const finish of CARD_FINISHES) {
    const amount = usdForFinish(prices, finish);
    if (amount !== null) return { amount, finish };
  }
  return null;
}

/** Convert a USD amount with a USD→target rate (rate 1 = USD). */
export function convertUsd(usd: number, rate: number): number {
  return usd * rate;
}

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Format an amount in a currency using the runtime's locale conventions
 * (e.g. "$1.23", "NZ$2.00", "€1,50" depending on locale). Falls back to a plain
 * "1.23 XYZ" if the code is unknown to Intl.
 */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  const key = `${locale ?? ""}|${currency}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(locale, { style: "currency", currency });
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
    formatters.set(key, fmt);
  }
  return fmt.format(amount);
}

// ---------------------------------------------------------------------------
// Price age
// ---------------------------------------------------------------------------

/** Under this age a price is "fresh" (matches the server's 24h refresh window). */
export const PRICE_FRESH_MS = 24 * 60 * 60 * 1000;
/** Under this age a price is merely "aging"; beyond it, "stale". */
export const PRICE_AGING_MS = 7 * PRICE_FRESH_MS;

export type PriceAgeLevel = "fresh" | "aging" | "stale" | "unknown";

export interface PriceAge {
  level: PriceAgeLevel;
  /** Milliseconds since the price was written, or null when unknown. */
  ageMs: number | null;
  /** Human label: "just now", "3 hours ago", "2 days ago", "unknown". */
  label: string;
}

export const PRICE_AGE_DESCRIPTIONS: Record<PriceAgeLevel, string> = {
  fresh: "updated within the last day",
  aging: "a few days old",
  stale: "over a week old",
  unknown: "never fetched"
};

/** Humanize an elapsed duration coarsely ("just now", "5 minutes ago", "3 days ago"). */
export function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** Grade how old a price is from its `prices_updated_at` stamp. */
export function priceAge(updatedAt: Date | string | null | undefined, now = Date.now()): PriceAge {
  if (!updatedAt) return { level: "unknown", ageMs: null, label: "unknown" };
  const t = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return { level: "unknown", ageMs: null, label: "unknown" };
  const ageMs = Math.max(0, now - t);
  const level: PriceAgeLevel =
    ageMs < PRICE_FRESH_MS ? "fresh" : ageMs < PRICE_AGING_MS ? "aging" : "stale";
  return { level, ageMs, label: formatAge(ageMs) };
}

/** The oldest of several stamps (null if none is known) — for a collection-wide indicator. */
export function oldestStamp(stamps: Array<Date | string | null | undefined>): string | null {
  let oldest: number | null = null;
  for (const s of stamps) {
    if (!s) continue;
    const t = s instanceof Date ? s.getTime() : new Date(s).getTime();
    if (!Number.isFinite(t)) continue;
    if (oldest === null || t < oldest) oldest = t;
  }
  return oldest === null ? null : new Date(oldest).toISOString();
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * A row of copies to value: an explicit per-copy unit price when the copies
 * were priced for their finish + condition (`unitUsd`, null = fetched but
 * unpriced), else the printing's prices + the copies' finish; and how many.
 */
export interface ValuedRow {
  unitUsd?: number | null;
  prices?: CardPrices | null;
  finish?: CardFinish | null;
  quantity: number;
}

/**
 * Total USD value of a set of rows (quantity × unit price), plus how many
 * copies had no price and were left out of the sum and how many were only
 * estimated from the printing's price (no copy-level fetch yet).
 */
export function totalUsd(rows: ValuedRow[]): { usd: number; unpriced: number; estimated: number } {
  let usd = 0;
  let unpriced = 0;
  let estimated = 0;
  for (const row of rows) {
    const explicit = row.unitUsd !== undefined;
    const unit = explicit ? row.unitUsd! : usdForFinish(row.prices, row.finish);
    if (!explicit) estimated += row.quantity;
    if (unit === null) unpriced += row.quantity;
    else usd += unit * row.quantity;
  }
  return { usd, unpriced, estimated };
}

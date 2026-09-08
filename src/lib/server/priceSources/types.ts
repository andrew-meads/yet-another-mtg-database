import { CardPrices } from "@/types/CardPrice";
import { PriceSourceId } from "@/lib/priceSources";
import { CardCondition, CardFinish } from "@/lib/cardAttributes";

/** Every finish, defaulting to null — the shape stored for an unpriced card. */
export const EMPTY_PRICES: CardPrices = {
  usd: null,
  usd_foil: null,
  usd_etched: null,
  eur: null,
  eur_foil: null,
  tix: null
};

/** The card fields a source adapter may need to identify a printing. */
export interface SourceCard {
  /** Scryfall id. */
  id: string;
  set: string;
  tcgplayer_id?: number;
  tcgplayer_etched_id?: number;
}

/**
 * One price source. `fetchPrices` returns prices ONLY for the cards it could
 * price (each with `source` set to the adapter's id); cards it knows nothing
 * about are simply absent. It throws on transport/format failure so the
 * resolver can log it and move on to the next source.
 */
/** One source's answer for a specific copy (finish + condition). */
export interface CopyPriceAnswer {
  usd: string;
  /** True when the source priced that condition tier, not just the finish. */
  matched: boolean;
}

export interface PriceSourceAdapter {
  id: PriceSourceId;
  fetchPrices(cards: SourceCard[]): Promise<Record<string, CardPrices>>;
  /**
   * Price copies of the given cards with a specific finish AND condition.
   * Optional: sources that only know finish-level (NM / market) prices omit it
   * and the resolver derives an answer from `fetchPrices` (matched only for NM).
   */
  fetchCopyPrices?(
    cards: SourceCard[],
    finish: CardFinish,
    condition: CardCondition
  ): Promise<Record<string, CopyPriceAnswer>>;
}

/** A `fetch` with a hard timeout, so a hung source never stalls a refresh. */
export function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/** Format a number of dollars as Scryfall does ("1.23"), or null. */
export function dollars(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}

/** Cents (integer) → "1.23", or null. */
export function centsToDollars(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return null;
  return (cents / 100).toFixed(2);
}

/**
 * True when the source supplied a price the app can actually use: a USD price
 * for some finish. USD is the app's native currency (everything displayed is
 * converted from it), so a EUR- or tix-only answer does NOT count as pricing a
 * card — the resolver keeps walking to the next source.
 */
export function hasUsdPrice(prices: CardPrices): boolean {
  return prices.usd !== null || prices.usd_foil !== null || prices.usd_etched !== null;
}

/** True when at least one price field is non-null. */
export function hasAnyPrice(prices: CardPrices): boolean {
  return (
    prices.usd !== null ||
    prices.usd_foil !== null ||
    prices.usd_etched !== null ||
    prices.eur !== null ||
    prices.eur_foil !== null ||
    prices.tix !== null
  );
}

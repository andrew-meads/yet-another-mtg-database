/**
 * Card pricing data, mirroring Scryfall's `prices` object. Every value is a
 * decimal string (e.g. "1.23") or `null` when Scryfall has no price for that
 * finish. USD is the native/primary currency; the app converts into the user's
 * chosen currency client-side using a separately-fetched exchange rate.
 *
 * Prices live directly on the card document (`MtgCard.prices`, exactly as the
 * Scryfall bulk data delivers them) alongside `prices_updated_at`, which drives
 * the 24h staleness check that decides whether to refresh them.
 *
 * `source` records which price source the numbers came from (see
 * `PRICE_SOURCES` in src/lib/priceSources.ts). It is optional and there is no
 * backfill: an absent value means Scryfall.
 */
export interface CardPrices {
  usd: string | null;
  usd_foil: string | null;
  usd_etched: string | null;
  eur: string | null;
  eur_foil: string | null;
  tix: string | null;
  /** Price source id ("scryfall" | "tcgplayer" | "manapool"); absent = Scryfall. */
  source?: string;
}

/**
 * The price of ONE physical copy, fetched for its finish and condition. Stored
 * on the physical card (`PhysicalCard.price`); absent = never fetched for this
 * copy, in which case the UI falls back to the printing's `CardPrices` and marks
 * it stale.
 */
export interface CopyPrice {
  /** USD unit price for this copy, or null when the sources had none. */
  usd: string | null;
  /** Price source id; absent = Scryfall. */
  source?: string;
  /** The finish this price was fetched for (compare with the copy's current finish). */
  finish: string;
  /** The condition this price was fetched for (compare with the copy's current condition). */
  condition: string;
  /**
   * True when the source priced this exact condition tier; false when only a
   * finish-level (Near Mint / market) price was available and used instead.
   */
  conditionMatched: boolean;
  /** When it was fetched: a Date from Mongo, an ISO string on the wire. */
  updatedAt: Date | string;
}

/** A card's prices plus when they were written (ISO string; null = never priced). */
export interface PriceQuote {
  prices: CardPrices;
  updatedAt: string | null;
}

/** Response of POST /api/cards/prices. */
export interface CardPriceQuotesResponse {
  prices: Record<string, CardPrices>;
  /** ISO timestamp per card id, or null for cards we hold no price stamp for. */
  updatedAt: Record<string, string | null>;
}

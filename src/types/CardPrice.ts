/**
 * Card pricing data, mirroring Scryfall's `prices` object. Every value is a
 * decimal string (e.g. "1.23") or `null` when Scryfall has no price for that
 * finish. USD is the native/primary currency; the app converts into the user's
 * chosen currency client-side using a separately-fetched exchange rate.
 */
export interface CardPrices {
  usd: string | null;
  usd_foil: string | null;
  usd_etched: string | null;
  eur: string | null;
  eur_foil: string | null;
  tix: string | null;
}

/**
 * A cached price record for a single card, keyed by Scryfall `id`. `updatedAt`
 * drives the 24h staleness check that decides whether to refresh from Scryfall.
 */
export interface CardPrice {
  cardId: string;
  prices: CardPrices;
  updatedAt: string;
}

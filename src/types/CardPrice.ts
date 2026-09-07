/**
 * Card pricing data, mirroring Scryfall's `prices` object. Every value is a
 * decimal string (e.g. "1.23") or `null` when Scryfall has no price for that
 * finish. USD is the native/primary currency; the app converts into the user's
 * chosen currency client-side using a separately-fetched exchange rate.
 *
 * Prices live directly on the card document (`MtgCard.prices`, exactly as the
 * Scryfall bulk data delivers them) alongside `prices_updated_at`, which drives
 * the 24h staleness check that decides whether to refresh them from Scryfall.
 */
export interface CardPrices {
  usd: string | null;
  usd_foil: string | null;
  usd_etched: string | null;
  eur: string | null;
  eur_foil: string | null;
  tix: string | null;
}

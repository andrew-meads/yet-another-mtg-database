/**
 * A cached currency exchange rate. `base` is always "USD" (Scryfall's native
 * currency); `rate` is how many units of `target` one unit of `base` buys.
 * `updatedAt` drives the 24h staleness check before re-fetching.
 */
export interface ExchangeRate {
  base: string;
  target: string;
  rate: number;
  updatedAt: string;
}

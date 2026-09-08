import { CardData } from "@/db/schema";
import { CardPriceQuotesResponse, CardPrices, PriceQuote } from "@/types/CardPrice";
import {
  PriceSourceId,
  DEFAULT_PRICE_SOURCE_PREFERENCES,
  enabledSourceOrder
} from "@/lib/priceSources";
import { resolvePricesViaSources } from "@/lib/server/priceSources";
import { EMPTY_PRICES, SourceCard } from "@/lib/server/priceSources/types";
import {
  SCRYFALL_COLLECTION_BATCH,
  chunk,
  extractPrices
} from "@/lib/server/priceSources/scryfall";

// Re-exported for existing importers (init-db, tests, the AI tools).
export { EMPTY_PRICES, SCRYFALL_COLLECTION_BATCH, chunk, extractPrices };

/** Prices older than this are refreshed (the marketplaces update ~daily). */
export const PRICE_STALENESS_MS = 24 * 60 * 60 * 1000;

/** The source order used when a caller has no user preference (e.g. AI tools). */
export const DEFAULT_SOURCE_ORDER: PriceSourceId[] = enabledSourceOrder(
  DEFAULT_PRICE_SOURCE_PREFERENCES
);

/** The minimal slice of a raw Scryfall card object the price helpers need. */
export interface ScryfallPricedCard {
  id: string;
  prices?: Partial<CardPrices> | null;
}

export interface PriceLookupOptions {
  /** Sources to try, in priority order (defaults to every source, default order). */
  sources?: PriceSourceId[];
}

/** Whether a price timestamp is still within the staleness window. */
export function isFresh(updatedAt: Date | string | undefined | null, now = Date.now()): boolean {
  if (!updatedAt) return false;
  const t = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
  return now - t < PRICE_STALENESS_MS;
}

/**
 * Build the bulkWrite operations that write each card's prices (plus the
 * `prices_updated_at` stamp) onto its existing `cards` document, matched by
 * Scryfall `id`. No upsert: a card we don't hold gets nothing. Later duplicates
 * of the same id win. Pure — the DB-touching wrapper is `applyCardPrices`.
 */
export function buildPriceUpdates(cards: ScryfallPricedCard[], now: Date = new Date()) {
  const byId = new Map<string, CardPrices>();
  for (const card of cards) {
    if (!card?.id) continue;
    byId.set(card.id, extractPrices(card));
  }
  return [...byId].map(([id, prices]) => ({
    updateOne: { filter: { id }, update: { $set: { prices, prices_updated_at: now } } }
  }));
}

/**
 * Write the prices carried by raw Scryfall card objects onto the matching
 * `cards` documents, OVERWRITING whatever prices they held and stamping
 * `prices_updated_at` = now (so the write counts as a fresh refresh for 24h).
 * Used by `init-db` to refresh prices of cards that already existed on a
 * re-import (new cards carry their prices in the insert itself). Bulk-data
 * prices are Scryfall's, so no `source` is stamped (absent = Scryfall).
 *
 * @returns the number of distinct card ids written
 */
export async function applyCardPrices(cards: ScryfallPricedCard[]): Promise<number> {
  const ops = buildPriceUpdates(cards);
  if (ops.length === 0) return 0;
  await CardData.bulkWrite(ops, { ordered: false });
  return ops.length;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const SOURCE_CARD_PROJECTION = {
  _id: 0,
  id: 1,
  set: 1,
  tcgplayer_id: 1,
  tcgplayer_etched_id: 1,
  prices: 1,
  prices_updated_at: 1
} as const;

type StoredCard = SourceCard & { prices?: Partial<CardPrices> | null; prices_updated_at?: Date };

/**
 * Fetch prices for the given held cards through the source chain and write
 * them onto the card documents with a fresh stamp. Cards no source could price
 * are stored as EMPTY_PRICES (so they aren't re-fetched every request) — but
 * only when every source answered; if a source failed, those cards keep
 * whatever they had (stale or nothing) and are returned as-is, so an outage
 * never gets recorded as "this card has no price". Returns quotes keyed by id.
 *
 * @throws when a source failed and nothing could be priced.
 */
async function fetchAndStore(
  cards: StoredCard[],
  order: PriceSourceId[],
  stamp: Date
): Promise<Record<string, PriceQuote>> {
  const { prices, failures } = await resolvePricesViaSources(cards, order);
  const result: Record<string, PriceQuote> = {};
  const writes: ScryfallPricedCard[] = [];
  for (const card of cards) {
    const found = prices[card.id];
    if (found) {
      writes.push({ id: card.id, prices: found });
      result[card.id] = { prices: found, updatedAt: stamp.toISOString() };
    } else if (failures.length === 0) {
      writes.push({ id: card.id, prices: EMPTY_PRICES });
      result[card.id] = { prices: EMPTY_PRICES, updatedAt: stamp.toISOString() };
    } else {
      result[card.id] = { prices: extractPrices(card), updatedAt: toIso(card.prices_updated_at) };
    }
  }
  if (writes.length > 0) {
    await CardData.bulkWrite(buildPriceUpdates(writes, stamp), { ordered: false });
  }
  return result;
}

/**
 * Resolve price quotes (prices + when they were written) for the given card
 * ids from the `cards` collection, serving values stamped < 24h ago as-is and
 * refreshing stale/never-priced cards through the price-source chain (the
 * user's enabled sources in priority order; see `resolvePricesViaSources`),
 * writing the results back onto the card documents. Ids we don't hold a card
 * for resolve to EMPTY_PRICES with a null stamp and no upstream call (there is
 * no document to keep a price on); a held card no source can price is stamped
 * with EMPTY_PRICES so it isn't re-fetched every request.
 */
export async function getCardPriceQuotes(
  cardIds: string[],
  options: PriceLookupOptions = {}
): Promise<Record<string, PriceQuote>> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return {};

  const cards = (await CardData.find(
    { id: { $in: ids } },
    SOURCE_CARD_PROJECTION
  ).lean()) as unknown as StoredCard[];

  const now = Date.now();
  const result: Record<string, PriceQuote> = {};
  const stale: StoredCard[] = [];
  for (const card of cards) {
    if (isFresh(card.prices_updated_at, now)) {
      result[card.id] = { prices: extractPrices(card), updatedAt: toIso(card.prices_updated_at) };
    } else {
      stale.push(card);
    }
  }

  if (stale.length > 0) {
    Object.assign(
      result,
      await fetchAndStore(stale, options.sources ?? DEFAULT_SOURCE_ORDER, new Date(now))
    );
  }

  for (const id of ids) result[id] ??= { prices: EMPTY_PRICES, updatedAt: null };
  return result;
}

/**
 * Re-fetch prices for the given ids REGARDLESS of how fresh they are (the
 * user's explicit "refresh" action), through the source chain, writing them
 * onto the card documents with a fresh stamp. Only held cards are looked up;
 * ids we hold no card for resolve to EMPTY_PRICES with a null stamp.
 *
 * @throws when every source fails, so the route can surface a 502.
 */
export async function refreshCardPriceQuotes(
  cardIds: string[],
  options: PriceLookupOptions = {}
): Promise<Record<string, PriceQuote>> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return {};

  const held = (await CardData.find(
    { id: { $in: ids } },
    SOURCE_CARD_PROJECTION
  ).lean()) as unknown as StoredCard[];
  const result: Record<string, PriceQuote> = {};

  if (held.length > 0) {
    Object.assign(
      result,
      await fetchAndStore(held, options.sources ?? DEFAULT_SOURCE_ORDER, new Date())
    );
  }

  for (const id of ids) result[id] ??= { prices: EMPTY_PRICES, updatedAt: null };
  return result;
}

/** Split a quote map into the `{ prices, updatedAt }` wire shape of the price routes. */
export function toPriceQuotesResponse(quotes: Record<string, PriceQuote>): CardPriceQuotesResponse {
  const prices: Record<string, CardPrices> = {};
  const updatedAt: Record<string, string | null> = {};
  for (const [id, quote] of Object.entries(quotes)) {
    prices[id] = quote.prices;
    updatedAt[id] = quote.updatedAt;
  }
  return { prices, updatedAt };
}

/** `getCardPriceQuotes` reduced to the prices alone (the AI tools' shape). */
export async function getCardPrices(
  cardIds: string[],
  options: PriceLookupOptions = {}
): Promise<Record<string, CardPrices>> {
  const quotes = await getCardPriceQuotes(cardIds, options);
  const result: Record<string, CardPrices> = {};
  for (const [id, quote] of Object.entries(quotes)) result[id] = quote.prices;
  return result;
}

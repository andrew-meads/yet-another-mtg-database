import { CardData } from "@/db/schema";
import { CardPrices } from "@/types/CardPrice";
import { scryfallFetch } from "@/lib/scryfall";

/** Prices older than this are refreshed from Scryfall (which updates ~daily). */
export const PRICE_STALENESS_MS = 24 * 60 * 60 * 1000;

/** Scryfall's /cards/collection accepts at most this many identifiers per request. */
export const SCRYFALL_COLLECTION_BATCH = 75;

/** Every finish, defaulting to null — the shape returned for an unpriced card. */
export const EMPTY_PRICES: CardPrices = {
  usd: null,
  usd_foil: null,
  usd_etched: null,
  eur: null,
  eur_foil: null,
  tix: null
};

/** The minimal slice of a raw Scryfall card object the price helpers need. */
export interface ScryfallPricedCard {
  id: string;
  prices?: Partial<CardPrices> | null;
}

/**
 * Pull the six price fields off a raw Scryfall card object (or a card document),
 * defaulting any missing finish to null. Pure — safe to unit-test without a DB
 * or network.
 */
export function extractPrices(card: { prices?: Partial<CardPrices> | null }): CardPrices {
  const p = card.prices ?? {};
  return {
    usd: p.usd ?? null,
    usd_foil: p.usd_foil ?? null,
    usd_etched: p.usd_etched ?? null,
    eur: p.eur ?? null,
    eur_foil: p.eur_foil ?? null,
    tix: p.tix ?? null
  };
}

/** Split an array into consecutive chunks of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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
 * re-import (new cards carry their prices in the insert itself).
 *
 * @returns the number of distinct card ids written
 */
export async function applyCardPrices(cards: ScryfallPricedCard[]): Promise<number> {
  const ops = buildPriceUpdates(cards);
  if (ops.length === 0) return 0;
  await CardData.bulkWrite(ops, { ordered: false });
  return ops.length;
}

/**
 * Fetch fresh prices for the given Scryfall ids from Scryfall's /cards/collection
 * endpoint, in batches of 75. Returns a map of cardId -> CardPrices for the cards
 * Scryfall returned (ids in `not_found` are simply absent from the map).
 *
 * @throws if any batch request fails (non-ok response or network error), so the
 * caller can surface a 502.
 */
async function fetchPricesFromScryfall(ids: string[]): Promise<Record<string, CardPrices>> {
  const result: Record<string, CardPrices> = {};
  for (const batch of chunk(ids, SCRYFALL_COLLECTION_BATCH)) {
    const url = `${process.env.SCRYFALL_API_BASE_URL}/cards/collection`;
    const response = await scryfallFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batch.map((id) => ({ id })) })
    });
    if (!response.ok) {
      throw new Error(`Scryfall /cards/collection returned ${response.status}`);
    }
    const body = (await response.json()) as {
      data?: Array<{ id: string } & Record<string, unknown>>;
    };
    for (const card of body.data ?? []) {
      result[card.id] = extractPrices(card as { prices?: Partial<CardPrices> | null });
    }
  }
  return result;
}

/**
 * Resolve prices for the given card ids from the `cards` collection, serving
 * values stamped < 24h ago as-is and batch-refreshing stale/never-priced cards
 * from Scryfall, writing the results back onto the card documents. Returns a map
 * of cardId -> CardPrices. Ids we don't hold a card for resolve to EMPTY_PRICES
 * without a Scryfall call (there is no document to keep a price on); a held card
 * Scryfall no longer returns is stamped with EMPTY_PRICES so it isn't re-fetched
 * every request.
 */
export async function getCardPrices(cardIds: string[]): Promise<Record<string, CardPrices>> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return {};

  const cards = await CardData.find(
    { id: { $in: ids } },
    { _id: 0, id: 1, prices: 1, prices_updated_at: 1 }
  ).lean();

  const now = Date.now();
  const result: Record<string, CardPrices> = {};
  const stale: string[] = [];
  for (const card of cards) {
    if (isFresh(card.prices_updated_at, now)) result[card.id] = extractPrices(card);
    else stale.push(card.id);
  }

  if (stale.length > 0) {
    const fetched = await fetchPricesFromScryfall(stale);
    const refreshed = stale.map((id) => ({ id, prices: fetched[id] ?? EMPTY_PRICES }));
    await CardData.bulkWrite(buildPriceUpdates(refreshed, new Date(now)), { ordered: false });
    for (const { id, prices } of refreshed) result[id] = prices;
  }

  for (const id of ids) result[id] ??= EMPTY_PRICES;
  return result;
}

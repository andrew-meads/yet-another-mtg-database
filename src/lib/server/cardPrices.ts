import { CardPriceModel } from "@/db/schema";
import { CardPrices } from "@/types/CardPrice";
import { scryfallFetch } from "@/lib/scryfall";

/** Prices older than this are refreshed from Scryfall (which updates ~daily). */
export const PRICE_STALENESS_MS = 24 * 60 * 60 * 1000;

/** Scryfall's /cards/collection accepts at most this many identifiers per request. */
export const SCRYFALL_COLLECTION_BATCH = 75;

/** Every finish, defaulting to null — the shape returned for an unknown card. */
export const EMPTY_PRICES: CardPrices = {
  usd: null,
  usd_foil: null,
  usd_etched: null,
  eur: null,
  eur_foil: null,
  tix: null
};

/**
 * Pull the six price fields off a raw Scryfall card object, defaulting any
 * missing finish to null. Pure — safe to unit-test without a DB or network.
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

/** Whether a cached record's timestamp is still within the staleness window. */
export function isFresh(updatedAt: Date | undefined, now = Date.now()): boolean {
  if (!updatedAt) return false;
  return now - updatedAt.getTime() < PRICE_STALENESS_MS;
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
    const body = (await response.json()) as { data?: Array<{ id: string } & Record<string, unknown>> };
    for (const card of body.data ?? []) {
      result[card.id] = extractPrices(card as { prices?: Partial<CardPrices> | null });
    }
  }
  return result;
}

/**
 * Resolve prices for the given card ids, serving fresh cached values (< 24h old)
 * and batch-refreshing stale/missing ones from Scryfall (upserting the results).
 * Returns a map of cardId -> CardPrices; ids Scryfall doesn't know about resolve
 * to EMPTY_PRICES.
 */
export async function getCardPrices(cardIds: string[]): Promise<Record<string, CardPrices>> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return {};

  const cached = await CardPriceModel.find({ cardId: { $in: ids } });

  const now = Date.now();
  const result: Record<string, CardPrices> = {};
  const fresh = new Set<string>();
  for (const doc of cached) {
    if (isFresh(doc.updatedAt, now)) {
      result[doc.cardId] = doc.prices;
      fresh.add(doc.cardId);
    }
  }

  const stale = ids.filter((id) => !fresh.has(id));
  if (stale.length > 0) {
    const fetched = await fetchPricesFromScryfall(stale);
    await Promise.all(
      Object.entries(fetched).map(([cardId, prices]) =>
        CardPriceModel.findOneAndUpdate({ cardId }, { prices }, { upsert: true })
      )
    );
    for (const id of stale) {
      result[id] = fetched[id] ?? EMPTY_PRICES;
    }
  }

  return result;
}

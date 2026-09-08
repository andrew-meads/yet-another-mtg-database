import { CardPrices } from "@/types/CardPrice";
import { scryfallFetch } from "@/lib/scryfall";
import { PriceSourceAdapter, SourceCard } from "./types";

/** Scryfall's /cards/collection accepts at most this many identifiers per request. */
export const SCRYFALL_COLLECTION_BATCH = 75;

/** Split an array into consecutive chunks of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Pull the six price fields (and, when present, the source) off a raw Scryfall
 * card object or a stored `prices` object, defaulting any missing finish to
 * null. Pure — safe to unit-test without a DB or network.
 */
export function extractPrices(card: { prices?: Partial<CardPrices> | null }): CardPrices {
  const p = card.prices ?? {};
  const out: CardPrices = {
    usd: p.usd ?? null,
    usd_foil: p.usd_foil ?? null,
    usd_etched: p.usd_etched ?? null,
    eur: p.eur ?? null,
    eur_foil: p.eur_foil ?? null,
    tix: p.tix ?? null
  };
  if (p.source) out.source = p.source;
  return out;
}

/**
 * Fetch prices for the given Scryfall ids from Scryfall's /cards/collection
 * endpoint, in batches of 75. Returns a map of cardId -> CardPrices for the
 * cards Scryfall returned (ids in `not_found` are simply absent).
 *
 * @throws if any batch request fails (non-ok response or network error).
 */
export async function fetchPricesFromScryfall(ids: string[]): Promise<Record<string, CardPrices>> {
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
      result[card.id] = {
        ...extractPrices(card as { prices?: Partial<CardPrices> | null }),
        source: "scryfall"
      };
    }
  }
  return result;
}

export const scryfallSource: PriceSourceAdapter = {
  id: "scryfall",
  fetchPrices: (cards: SourceCard[]) => fetchPricesFromScryfall(cards.map((c) => c.id))
};

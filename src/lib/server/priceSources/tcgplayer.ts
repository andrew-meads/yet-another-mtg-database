import { CardPrices } from "@/types/CardPrice";
import { SCRYFALL_HEADERS, scryfallFetch } from "@/lib/scryfall";
import {
  EMPTY_PRICES,
  PriceSourceAdapter,
  SourceCard,
  dollars,
  fetchWithTimeout,
  hasAnyPrice
} from "./types";

/**
 * TCGplayer market prices via TCGCSV (tcgcsv.com), a free daily mirror of
 * TCGplayer's product/price data. Prices are published per TCGplayer *group*
 * (a set) as `{ productId, subTypeName: "Normal" | "Foil", marketPrice, … }`.
 * A Scryfall card carries its product id (`tcgplayer_id`, plus
 * `tcgplayer_etched_id` for an etched printing sold separately) and its set's
 * group id is Scryfall's set `tcgplayer_id`, so pricing a card is: set →
 * group id → the group's price list → the card's product rows.
 */

const DEFAULT_TCGCSV_BASE_URL = "https://tcgcsv.com";
/** TCGCSV's category id for Magic: The Gathering. */
export const TCGCSV_MAGIC_CATEGORY = 1;
/** TCGCSV refreshes daily; group price lists are kept this long in memory. */
const GROUP_PRICES_TTL_MS = 60 * 60 * 1000;
/** Set → group id rarely changes; keep it for a day. */
const GROUP_ID_TTL_MS = 24 * 60 * 60 * 1000;
/** Parallel group-list downloads per resolve call. */
const GROUP_CONCURRENCY = 3;

export interface TcgcsvPriceRow {
  productId: number;
  subTypeName: string;
  marketPrice: number | null;
  midPrice: number | null;
  lowPrice: number | null;
}

/** Index a group's price rows by `productId|subTypeName` (case-insensitive subtype). */
export function indexTcgcsvPrices(rows: TcgcsvPriceRow[]): Map<string, TcgcsvPriceRow> {
  const index = new Map<string, TcgcsvPriceRow>();
  for (const row of rows) {
    if (!row || typeof row.productId !== "number") continue;
    index.set(`${row.productId}|${String(row.subTypeName ?? "").toLowerCase()}`, row);
  }
  return index;
}

/** Market price, falling back to mid then low (TCGCSV documents high as unreliable). */
function rowPrice(row: TcgcsvPriceRow | undefined): number | null {
  if (!row) return null;
  return row.marketPrice ?? row.midPrice ?? row.lowPrice ?? null;
}

/**
 * The USD prices of one card from an indexed group. Pure. Returns null when the
 * card has no priced TCGplayer product in the index.
 */
export function pricesFromTcgcsv(
  card: Pick<SourceCard, "tcgplayer_id" | "tcgplayer_etched_id">,
  index: Map<string, TcgcsvPriceRow>
): CardPrices | null {
  const prices: CardPrices = { ...EMPTY_PRICES, source: "tcgplayer" };
  if (card.tcgplayer_id) {
    prices.usd = dollars(rowPrice(index.get(`${card.tcgplayer_id}|normal`)));
    prices.usd_foil = dollars(rowPrice(index.get(`${card.tcgplayer_id}|foil`)));
  }
  if (card.tcgplayer_etched_id) {
    prices.usd_etched = dollars(
      rowPrice(
        index.get(`${card.tcgplayer_etched_id}|foil`) ??
          index.get(`${card.tcgplayer_etched_id}|normal`)
      )
    );
  }
  return hasAnyPrice(prices) ? prices : null;
}

// ---------------------------------------------------------------------------
// Caches (module-level, survive Next dev hot reloads via globalThis)
// ---------------------------------------------------------------------------

interface Cached<T> {
  value: T;
  fetchedAt: number;
}

const g = globalThis as unknown as {
  __tcgcsvGroupIds?: Map<string, Cached<number | null>>;
  __tcgcsvGroupPrices?: Map<number, Cached<Map<string, TcgcsvPriceRow>>>;
};
g.__tcgcsvGroupIds ??= new Map();
g.__tcgcsvGroupPrices ??= new Map();

/** Test hook: forget every cached group id / price list. */
export function clearTcgcsvCaches() {
  g.__tcgcsvGroupIds!.clear();
  g.__tcgcsvGroupPrices!.clear();
}

function baseUrl(): string {
  return process.env.TCGCSV_BASE_URL || DEFAULT_TCGCSV_BASE_URL;
}

/** Scryfall set code → TCGplayer group id (null when the set has none). */
async function groupIdForSet(setCode: string): Promise<number | null> {
  const cached = g.__tcgcsvGroupIds!.get(setCode);
  if (cached && Date.now() - cached.fetchedAt < GROUP_ID_TTL_MS) return cached.value;

  const res = await scryfallFetch(
    `${process.env.SCRYFALL_API_BASE_URL}/sets/${encodeURIComponent(setCode)}`
  );
  if (!res.ok) throw new Error(`Scryfall /sets/${setCode} returned ${res.status}`);
  const body = (await res.json()) as { tcgplayer_id?: number | null };
  const value = typeof body.tcgplayer_id === "number" ? body.tcgplayer_id : null;
  g.__tcgcsvGroupIds!.set(setCode, { value, fetchedAt: Date.now() });
  return value;
}

/** A group's indexed price list, fetched from TCGCSV (cached ~1h). */
async function groupPrices(groupId: number): Promise<Map<string, TcgcsvPriceRow>> {
  const cached = g.__tcgcsvGroupPrices!.get(groupId);
  if (cached && Date.now() - cached.fetchedAt < GROUP_PRICES_TTL_MS) return cached.value;

  const res = await fetchWithTimeout(
    `${baseUrl()}/tcgplayer/${TCGCSV_MAGIC_CATEGORY}/${groupId}/prices`,
    { headers: { "User-Agent": SCRYFALL_HEADERS["User-Agent"], Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`TCGCSV group ${groupId} prices returned ${res.status}`);
  const body = (await res.json()) as { results?: TcgcsvPriceRow[] };
  if (!Array.isArray(body.results)) throw new Error(`TCGCSV group ${groupId}: malformed response`);
  const value = indexTcgcsvPrices(body.results);
  g.__tcgcsvGroupPrices!.set(groupId, { value, fetchedAt: Date.now() });
  return value;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export const tcgplayerSource: PriceSourceAdapter = {
  id: "tcgplayer",
  async fetchPrices(cards: SourceCard[]): Promise<Record<string, CardPrices>> {
    const result: Record<string, CardPrices> = {};
    const candidates = cards.filter((c) => c.tcgplayer_id || c.tcgplayer_etched_id);
    if (candidates.length === 0) return result;

    const bySet = new Map<string, SourceCard[]>();
    for (const card of candidates) {
      const list = bySet.get(card.set) ?? [];
      list.push(card);
      bySet.set(card.set, list);
    }

    await mapLimit([...bySet.entries()], GROUP_CONCURRENCY, async ([setCode, setCards]) => {
      const groupId = await groupIdForSet(setCode);
      if (groupId === null) return;
      const index = await groupPrices(groupId);
      for (const card of setCards) {
        const prices = pricesFromTcgcsv(card, index);
        if (prices) result[card.id] = prices;
      }
    });
    return result;
  }
};

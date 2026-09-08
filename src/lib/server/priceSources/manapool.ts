import { CardPrices } from "@/types/CardPrice";
import { SCRYFALL_HEADERS } from "@/lib/scryfall";
import {
  CopyPriceAnswer,
  EMPTY_PRICES,
  PriceSourceAdapter,
  SourceCard,
  centsToDollars,
  fetchWithTimeout,
  hasAnyPrice
} from "./types";
import { CardCondition, CardFinish } from "@/lib/cardAttributes";

/**
 * Mana Pool marketplace prices. Mana Pool publishes ONE bulk feed of every
 * single it stocks (`/api/v1/prices/singles`, ~50 MB, keyed by Scryfall id,
 * prices in cents, no auth) and no per-card endpoint — so the adapter downloads
 * the feed at most once a day, keeps it indexed in memory, and answers lookups
 * from that snapshot. The first refresh that needs it pays the download.
 */

const DEFAULT_MANAPOOL_BASE_URL = "https://manapool.com";
/** The feed's CDN cache is 10 minutes; a day is plenty for a marketplace snapshot. */
const FEED_TTL_MS = 24 * 60 * 60 * 1000;

export interface ManapoolEntry {
  scryfall_id: string;
  price_cents?: number | null;
  price_cents_lp_plus?: number | null;
  price_cents_nm?: number | null;
  price_cents_foil?: number | null;
  price_cents_lp_plus_foil?: number | null;
  price_cents_nm_foil?: number | null;
  price_cents_etched?: number | null;
  price_cents_lp_plus_etched?: number | null;
  price_cents_nm_etched?: number | null;
  price_market?: number | null;
  price_market_foil?: number | null;
}

/** The feed's per-finish field suffixes. */
const FINISH_SUFFIX: Record<CardFinish, string> = { nonfoil: "", foil: "_foil", etched: "_etched" };

function cents(entry: ManapoolEntry, field: string): number | null | undefined {
  return (entry as unknown as Record<string, number | null | undefined>)[field];
}

/**
 * Mana Pool's listing tiers per condition: Near Mint copies use the NM tier
 * (or the market price), Lightly Played the "LP or better" tier, and anything
 * more worn the lowest listing of any condition — the closest signal the feed
 * offers. When the exact tier has no listing the next-best finish-level price
 * is used and the answer is flagged as not condition-matched. Pure.
 */
export function copyPriceFromManapoolEntry(
  entry: ManapoolEntry,
  finish: CardFinish,
  condition: CardCondition
): CopyPriceAnswer | null {
  const sfx = FINISH_SUFFIX[finish];
  const nm = cents(entry, `price_cents_nm${sfx}`);
  const market = finish === "etched" ? null : cents(entry, `price_market${sfx}`);
  const lpPlus = cents(entry, `price_cents_lp_plus${sfx}`);
  const any = cents(entry, `price_cents${sfx}`);

  const tier = condition === "NM" ? (nm ?? market) : condition === "LP" ? lpPlus : any;
  if (tier !== null && tier !== undefined) {
    return { usd: centsToDollars(tier)!, matched: true };
  }
  const fallback = market ?? nm ?? lpPlus ?? any;
  if (fallback !== null && fallback !== undefined) {
    return { usd: centsToDollars(fallback)!, matched: false };
  }
  return null;
}

/**
 * Map one feed entry to CardPrices: market price when Mana Pool computes one,
 * else the lowest Near Mint listing, else the lowest listing of any condition.
 * Pure. Null when the entry carries no price at all.
 */
export function pricesFromManapoolEntry(entry: ManapoolEntry): CardPrices | null {
  const prices: CardPrices = {
    ...EMPTY_PRICES,
    usd: centsToDollars(entry.price_market ?? entry.price_cents_nm ?? entry.price_cents),
    usd_foil: centsToDollars(
      entry.price_market_foil ?? entry.price_cents_nm_foil ?? entry.price_cents_foil
    ),
    usd_etched: centsToDollars(entry.price_cents_nm_etched ?? entry.price_cents_etched),
    source: "manapool"
  };
  return hasAnyPrice(prices) ? prices : null;
}

/** Index a feed by Scryfall id (later duplicates win). */
export function indexManapoolFeed(entries: ManapoolEntry[]): Map<string, ManapoolEntry> {
  const index = new Map<string, ManapoolEntry>();
  for (const entry of entries) {
    if (entry && typeof entry.scryfall_id === "string") index.set(entry.scryfall_id, entry);
  }
  return index;
}

const g = globalThis as unknown as {
  __manapoolFeed?: { index: Map<string, ManapoolEntry>; fetchedAt: number } | null;
};

/** Test hook: forget the cached feed. */
export function clearManapoolCache() {
  g.__manapoolFeed = null;
}

async function feedIndex(): Promise<Map<string, ManapoolEntry>> {
  const cached = g.__manapoolFeed;
  if (cached && Date.now() - cached.fetchedAt < FEED_TTL_MS) return cached.index;

  const base = process.env.MANAPOOL_API_BASE_URL || DEFAULT_MANAPOOL_BASE_URL;
  const res = await fetchWithTimeout(
    `${base}/api/v1/prices/singles`,
    { headers: { "User-Agent": SCRYFALL_HEADERS["User-Agent"], Accept: "application/json" } },
    60_000
  );
  if (!res.ok) throw new Error(`Mana Pool prices feed returned ${res.status}`);
  const body = (await res.json()) as { data?: ManapoolEntry[] };
  if (!Array.isArray(body.data)) throw new Error("Mana Pool prices feed: malformed response");
  const index = indexManapoolFeed(body.data);
  g.__manapoolFeed = { index, fetchedAt: Date.now() };
  return index;
}

export const manapoolSource: PriceSourceAdapter = {
  id: "manapool",
  async fetchPrices(cards: SourceCard[]): Promise<Record<string, CardPrices>> {
    const result: Record<string, CardPrices> = {};
    if (cards.length === 0) return result;
    const index = await feedIndex();
    for (const card of cards) {
      const entry = index.get(card.id);
      const prices = entry ? pricesFromManapoolEntry(entry) : null;
      if (prices) result[card.id] = prices;
    }
    return result;
  },
  async fetchCopyPrices(cards, finish, condition) {
    const result: Record<string, CopyPriceAnswer> = {};
    if (cards.length === 0) return result;
    const index = await feedIndex();
    for (const card of cards) {
      const entry = index.get(card.id);
      const answer = entry ? copyPriceFromManapoolEntry(entry, finish, condition) : null;
      if (answer) result[card.id] = answer;
    }
    return result;
  }
};

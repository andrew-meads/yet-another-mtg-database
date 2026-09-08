/**
 * The price sources the app can pull from, and the user's ordering/enabling
 * of them. Pure and client-safe: shared by the settings UI, the zod schema,
 * and the server-side resolver (whose adapters live in
 * src/lib/server/priceSources/). Add a source here first, then its adapter.
 */
import { CardPrices } from "@/types/CardPrice";

export const PRICE_SOURCE_IDS = ["scryfall", "tcgplayer", "manapool"] as const;
export type PriceSourceId = (typeof PRICE_SOURCE_IDS)[number];

/** The source a `prices` object with no `source` field came from (pre-existing data). */
export const DEFAULT_PRICE_SOURCE: PriceSourceId = "scryfall";

export interface PriceSourceInfo {
  id: PriceSourceId;
  /** Short display name ("TCGplayer"). */
  name: string;
  /** What the numbers are: marketplace and kind of price. */
  description: string;
  /** Where the data is fetched from (shown in settings so the user knows who they hit). */
  via: string;
}

export const PRICE_SOURCES: Record<PriceSourceId, PriceSourceInfo> = {
  scryfall: {
    id: "scryfall",
    name: "Scryfall",
    description:
      "TCGplayer market (USD), Cardmarket (EUR) and MTGO (tix) prices as published by Scryfall.",
    via: "api.scryfall.com"
  },
  tcgplayer: {
    id: "tcgplayer",
    name: "TCGplayer",
    description:
      "TCGplayer market prices (USD) per printing and finish, from the daily TCGCSV mirror.",
    via: "tcgcsv.com"
  },
  manapool: {
    id: "manapool",
    name: "Mana Pool",
    description:
      "Mana Pool marketplace prices (USD): market price, falling back to the lowest NM listing.",
    via: "manapool.com"
  }
};

/** One entry of the user's ordered source list. */
export interface PriceSourcePreference {
  id: PriceSourceId;
  enabled: boolean;
}

/** Default priority: Scryfall first (the historical source), then the marketplaces. */
export const DEFAULT_PRICE_SOURCE_PREFERENCES: PriceSourcePreference[] = PRICE_SOURCE_IDS.map(
  (id) => ({ id, enabled: true })
);

export function isPriceSourceId(value: unknown): value is PriceSourceId {
  return typeof value === "string" && (PRICE_SOURCE_IDS as readonly string[]).includes(value);
}

/**
 * Sanitize a stored/incoming preference list: unknown ids and duplicates are
 * dropped, and any known source missing from the list is appended (enabled) in
 * default order — so adding a source later never hides it, and an absent list
 * yields the defaults.
 */
export function normalizeSourcePreferences(
  prefs: Array<{ id: unknown; enabled?: unknown }> | null | undefined
): PriceSourcePreference[] {
  const out: PriceSourcePreference[] = [];
  const seen = new Set<PriceSourceId>();
  for (const pref of prefs ?? []) {
    if (!isPriceSourceId(pref?.id) || seen.has(pref.id)) continue;
    seen.add(pref.id);
    out.push({ id: pref.id, enabled: pref.enabled !== false });
  }
  for (const id of PRICE_SOURCE_IDS) {
    if (!seen.has(id)) out.push({ id, enabled: true });
  }
  return out;
}

/** The ids to try, in priority order, skipping disabled ones. */
export function enabledSourceOrder(prefs: PriceSourcePreference[]): PriceSourceId[] {
  return prefs.filter((p) => p.enabled).map((p) => p.id);
}

/** Move the source at `index` one step up (-1) or down (+1); no-op at the edges. */
export function moveSourcePreference(
  prefs: PriceSourcePreference[],
  index: number,
  direction: -1 | 1
): PriceSourcePreference[] {
  const target = index + direction;
  if (index < 0 || index >= prefs.length || target < 0 || target >= prefs.length) return prefs;
  const next = prefs.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Which source a prices object came from (absent = Scryfall, the pre-existing data). */
export function effectivePriceSource(
  prices: Pick<CardPrices, "source"> | null | undefined
): PriceSourceId {
  return isPriceSourceId(prices?.source) ? prices.source : DEFAULT_PRICE_SOURCE;
}

export function priceSourceName(prices: Pick<CardPrices, "source"> | null | undefined): string {
  return PRICE_SOURCES[effectivePriceSource(prices)].name;
}

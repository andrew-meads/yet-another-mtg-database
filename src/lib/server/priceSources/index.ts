import { CardPrices } from "@/types/CardPrice";
import { PRICE_SOURCES, PriceSourceId } from "@/lib/priceSources";
import { CopyPriceAnswer, PriceSourceAdapter, SourceCard, hasUsdPrice } from "./types";
import { CardCondition, CardFinish } from "@/lib/cardAttributes";
import { usdForFinish } from "@/lib/pricing";
import { scryfallSource } from "./scryfall";
import { tcgplayerSource } from "./tcgplayer";
import { manapoolSource } from "./manapool";

export const PRICE_SOURCE_ADAPTERS: Record<PriceSourceId, PriceSourceAdapter> = {
  scryfall: scryfallSource,
  tcgplayer: tcgplayerSource,
  manapool: manapoolSource
};

export interface SourceFailure {
  source: PriceSourceId;
  error: string;
}

export interface ResolvedPrices {
  /** Prices for every card some source could price (each stamped with its `source`). */
  prices: Record<string, CardPrices>;
  /** Sources that threw (logged and skipped). */
  failures: SourceFailure[];
  /** Sources that were asked and answered (even if they priced nothing). */
  succeeded: PriceSourceId[];
}

/**
 * Walk the enabled sources in priority order, asking each for the cards that
 * are still unpriced, until every card has a price or the sources run out. A
 * card counts as priced only once a source supplies a USD price for some finish
 * (see `hasUsdPrice`) — Scryfall answering with a Cardmarket EUR price alone,
 * for example, does not stop the walk. A
 * source that throws is recorded and skipped — so an outage at one marketplace
 * just falls through to the next. Cards no source could price are absent from
 * the result; the caller decides what to store for them (and should NOT mark
 * them "unpriced" when `failures` is non-empty, since a failed source might
 * have priced them).
 *
 * @throws when a source failed and nothing at all could be priced — the
 * emptiness may be the outage, so the caller should surface an upstream error
 * rather than record "no price".
 */
export async function resolvePricesViaSources(
  cards: SourceCard[],
  order: PriceSourceId[],
  adapters: Record<PriceSourceId, PriceSourceAdapter> = PRICE_SOURCE_ADAPTERS
): Promise<ResolvedPrices> {
  const prices: Record<string, CardPrices> = {};
  const failures: SourceFailure[] = [];
  const succeeded: PriceSourceId[] = [];
  let remaining = cards;

  for (const sourceId of order) {
    if (remaining.length === 0) break;
    const adapter = adapters[sourceId];
    if (!adapter) continue;
    try {
      const found = await adapter.fetchPrices(remaining);
      succeeded.push(sourceId);
      for (const card of remaining) {
        const p = found[card.id];
        if (p && hasUsdPrice(p)) prices[card.id] = { ...p, source: sourceId };
      }
      remaining = remaining.filter((c) => !prices[c.id]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[prices] source ${PRICE_SOURCES[sourceId].name} failed: ${message}`);
      failures.push({ source: sourceId, error: message });
    }
  }

  if (failures.length > 0 && Object.keys(prices).length === 0) {
    throw new Error(
      `No price source could answer: ${failures.map((f) => `${f.source} (${f.error})`).join("; ")}`
    );
  }
  return { prices, failures, succeeded };
}

/**
 * A source's answer for copies of the given finish + condition: its own
 * condition-aware pricing when it has one, otherwise derived from its
 * finish-level prices (matched only when the copy is Near Mint, which is what
 * a market/NM price describes).
 */
export async function copyPricesFromAdapter(
  adapter: PriceSourceAdapter,
  cards: SourceCard[],
  finish: CardFinish,
  condition: CardCondition
): Promise<Record<string, CopyPriceAnswer>> {
  if (adapter.fetchCopyPrices) return adapter.fetchCopyPrices(cards, finish, condition);
  const prices = await adapter.fetchPrices(cards);
  const result: Record<string, CopyPriceAnswer> = {};
  for (const card of cards) {
    const usd = usdForFinish(prices[card.id], finish);
    if (usd !== null) result[card.id] = { usd: usd.toFixed(2), matched: condition === "NM" };
  }
  return result;
}

/** A batch of copies sharing a finish + condition, to price together. */
export interface CopyPriceGroup {
  finish: CardFinish;
  condition: CardCondition;
  cards: SourceCard[];
}

export interface ResolvedCopyPrice extends CopyPriceAnswer {
  source: PriceSourceId;
}

/** Key of a resolved copy price: `cardId|finish|condition`. */
export function copyPriceKey(cardId: string, finish: CardFinish, condition: CardCondition): string {
  return `${cardId}|${finish}|${condition}`;
}

export interface ResolvedCopyPrices {
  prices: Record<string, ResolvedCopyPrice>;
  failures: SourceFailure[];
  succeeded: PriceSourceId[];
}

/**
 * Price copies by finish AND condition through the sources in priority order.
 * For each copy the FIRST source (in order) that priced its exact condition
 * tier wins; if none did, the first source with any USD price for the finish
 * is used (flagged `matched: false`). Sources are asked in order and skipped
 * once every copy in a group has a matched answer; a throwing source is
 * recorded and skipped.
 *
 * @throws when a source failed and no copy at all could be priced.
 */
export async function resolveCopyPrices(
  groups: CopyPriceGroup[],
  order: PriceSourceId[],
  adapters: Record<PriceSourceId, PriceSourceAdapter> = PRICE_SOURCE_ADAPTERS
): Promise<ResolvedCopyPrices> {
  const prices: Record<string, ResolvedCopyPrice> = {};
  const failures: SourceFailure[] = [];
  const succeeded = new Set<PriceSourceId>();

  for (const group of groups) {
    let pending = group.cards;
    for (const sourceId of order) {
      if (pending.length === 0) break;
      const adapter = adapters[sourceId];
      if (!adapter) continue;
      try {
        const answers = await copyPricesFromAdapter(
          adapter,
          pending,
          group.finish,
          group.condition
        );
        succeeded.add(sourceId);
        for (const card of pending) {
          const answer = answers[card.id];
          if (!answer) continue;
          const key = copyPriceKey(card.id, group.finish, group.condition);
          const current = prices[key];
          if (!current || (!current.matched && answer.matched)) {
            prices[key] = { ...answer, source: sourceId };
          }
        }
        // Keep asking later sources only for copies still lacking a matched answer.
        pending = pending.filter(
          (card) => !prices[copyPriceKey(card.id, group.finish, group.condition)]?.matched
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[prices] source ${PRICE_SOURCES[sourceId].name} failed: ${message}`);
        if (!failures.some((f) => f.source === sourceId)) {
          failures.push({ source: sourceId, error: message });
        }
      }
    }
  }

  if (failures.length > 0 && Object.keys(prices).length === 0) {
    throw new Error(
      `No price source could answer: ${failures.map((f) => `${f.source} (${f.error})`).join("; ")}`
    );
  }
  return { prices, failures, succeeded: [...succeeded] };
}

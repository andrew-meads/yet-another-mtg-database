/**
 * How a set of physical copies (a collection row, a deck card, the copies the
 * user clicked) is priced for display. Pure and client-safe — shared by the
 * collection row cell (`CopyPriceTag`) and the selected-card panel so the two
 * can never disagree.
 */
import { CopyPrice, PriceQuote } from "@/types/CardPrice";
import {
  CONDITION_LABELS,
  CardCondition,
  CardFinish,
  FINISH_LABELS,
  effectiveCondition,
  effectiveFinish,
  isProxyCopy
} from "@/lib/cardAttributes";
import { parsePrice, usdForFinish } from "@/lib/pricing";
import { PRICE_SOURCES, effectivePriceSource } from "@/lib/priceSources";

/**
 * The price a whole set of copies was fetched at — present only when EVERY
 * copy carries a `price` record for the given finish + condition (a copy whose
 * finish/condition changed since its fetch, or was never fetched, invalidates
 * it and the set falls back to the printing's price).
 */
export interface RowCopyPrice {
  /** USD unit price, null when the sources had none for this finish + condition. */
  usd: number | null;
  source?: string;
  /** True when every copy's source priced the exact condition tier. */
  conditionMatched: boolean;
  /** Oldest fetch time among the copies (ISO), for the age indicator. */
  updatedAt: string;
}

/**
 * Fold the copies' `price` records into one price, or undefined when any copy
 * lacks a record matching the finish + condition.
 */
export function rowCopyPrice(
  copies: Array<{ price?: CopyPrice }>,
  finish: CardFinish,
  condition: CardCondition
): RowCopyPrice | undefined {
  let usd: number | null | undefined;
  let source: string | undefined;
  let matched = true;
  let oldest: number | undefined;
  for (const copy of copies) {
    const p = copy.price;
    if (!p || p.finish !== finish || p.condition !== condition) return undefined;
    const t = new Date(p.updatedAt).getTime();
    if (!Number.isFinite(t)) return undefined;
    if (usd === undefined) {
      usd = parsePrice(p.usd);
      source = p.source;
    }
    matched &&= p.conditionMatched;
    oldest = oldest === undefined ? t : Math.min(oldest, t);
  }
  if (usd === undefined || oldest === undefined) return undefined;
  return { usd, source, conditionMatched: matched, updatedAt: new Date(oldest).toISOString() };
}

/** The attributes shared by a set of copies priced together. */
export interface CopySet {
  finish: CardFinish;
  condition: CardCondition;
  /** True when the copies carry the "Proxy" tag: worth $0, never priced. */
  isProxy: boolean;
  copyPrice?: RowCopyPrice;
}

/** Derive a CopySet from raw copies (all assumed to share finish/condition/tags). */
export function copySetFromCopies(
  copies: Array<{
    price?: CopyPrice;
    tags?: string[];
    finish?: CardFinish;
    condition?: CardCondition;
  }>
): CopySet {
  const first = copies[0];
  const finish = effectiveFinish(first?.finish);
  const condition = effectiveCondition(first?.condition);
  return {
    finish,
    condition,
    isProxy: isProxyCopy(first?.tags),
    copyPrice: rowCopyPrice(copies, finish, condition)
  };
}

/** Description of the fallback state shown on the age dot. */
export const ESTIMATED_PRICE_DESCRIPTION =
  "Estimated from the printing's price — refresh to price these copies for their finish and condition";

export type CopyPriceView =
  | { kind: "proxy"; usd: 0 }
  | {
      kind: "copy";
      usd: number | null;
      source: string;
      conditionMatched: boolean;
      updatedAt: string;
    }
  | { kind: "estimate"; usd: number | null; source: string; updatedAt: string | null };

/**
 * Decide what to show for a set of copies: a proxy is always $0; copies priced
 * for their finish + condition show that price; otherwise the printing's
 * finish-level price is an estimate (to be marked stale).
 */
export function copyPriceView(set: CopySet, quote: PriceQuote | null | undefined): CopyPriceView {
  if (set.isProxy) return { kind: "proxy", usd: 0 };
  if (set.copyPrice) {
    return {
      kind: "copy",
      usd: set.copyPrice.usd,
      source: PRICE_SOURCES[effectivePriceSource(set.copyPrice)].name,
      conditionMatched: set.copyPrice.conditionMatched,
      updatedAt: set.copyPrice.updatedAt
    };
  }
  return {
    kind: "estimate",
    usd: usdForFinish(quote?.prices, set.finish),
    source: PRICE_SOURCES[effectivePriceSource(quote?.prices)].name,
    updatedAt: quote?.updatedAt ?? null
  };
}

/** Human explanation of a view, for tooltips and the panel ("… in NZD"). */
export function describeCopyPriceView(view: CopyPriceView, set: CopySet, currency: string): string {
  const finishLabel = FINISH_LABELS[set.finish].toLowerCase();
  const conditionLabel = `${set.condition} (${CONDITION_LABELS[set.condition]})`;
  switch (view.kind) {
    case "proxy":
      return "Proxy — counted as 0 regardless of market prices";
    case "copy":
      return view.conditionMatched
        ? `${view.source} price for ${finishLabel}, ${conditionLabel}, in ${currency}`
        : `${view.source} ${finishLabel} price in ${currency} — no ${set.condition} price available, so the finish-level price is used`;
    case "estimate":
      return `${view.source} ${finishLabel} price in ${currency}, not yet priced for ${conditionLabel}`;
  }
}

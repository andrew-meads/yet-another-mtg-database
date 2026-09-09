"use client";

import { useMemo } from "react";
import { SlimMtgCard } from "@/types/MtgCard";
import { CARD_FINISHES, CONDITION_LABELS, FINISH_LABELS } from "@/lib/cardAttributes";
import { priceAge, usdForFinish } from "@/lib/pricing";
import { PRICE_SOURCES, effectivePriceSource } from "@/lib/priceSources";
import {
  CopySet,
  ESTIMATED_PRICE_DESCRIPTION,
  copyPriceView,
  copySetFromCopies,
  describeCopyPriceView
} from "@/lib/copyPricing";
import { useCurrency } from "@/hooks/useCurrency";
import { quoteForCard, useCardPriceQuotes } from "@/hooks/react-query/useCardPriceQuotes";
import { useCardLocations } from "@/hooks/react-query/useCardLocations";
import { SelectedCopies, useCardSelection } from "@/context/CardSelectionContext";
import { PriceQuote } from "@/types/CardPrice";
import PriceAgeDot from "./PriceAgeDot";
import RefreshPriceButton from "./RefreshPriceButton";

/**
 * The price block of the selected-card panel.
 *
 * When the card was selected AS physical copies (a collection row, a deck
 * card, a card-locations row), a "Your copies" block comes first: the copies'
 * own finish + condition price (or the printing's price as a stale estimate,
 * or $0 for a proxy) with its source and age and a refresh icon that prices
 * exactly those copies. The copies' live records are read from the
 * card-locations query (which every price/edit mutation invalidates), falling
 * back to the snapshot taken at click time (e.g. for deck-only copies, which
 * card locations don't list).
 *
 * The printing's per-finish prices follow, as before: fetched (and thereby
 * refreshed) on mount, with the prices carried on the card object shown until
 * the quote lands.
 */
export default function CardPricesPanel({ card }: { card: SlimMtgCard }) {
  const ids = useMemo(() => [card.id], [card.id]);
  const { quotes } = useCardPriceQuotes(ids);
  const quote = quoteForCard(card, quotes);
  const { format, currency, configured, loading } = useCurrency();
  const { selectedCopies } = useCardSelection();
  const copies = selectedCopies && selectedCopies.cardId === card.id ? selectedCopies : null;

  const lines = CARD_FINISHES.map((finish) => ({
    finish,
    usd: usdForFinish(quote?.prices, finish)
  })).filter((l) => l.usd !== null);
  const age = priceAge(quote?.updatedAt);

  return (
    <section className="mb-4 rounded-md border p-3 text-sm" data-testid="card-prices-panel">
      {copies && <YourCopies card={card} selection={copies} quote={quote} />}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h4 className="font-semibold">{copies ? "This printing" : "Prices"}</h4>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs whitespace-nowrap">
          <PriceAgeDot updatedAt={quote?.updatedAt} />
          {age.level === "unknown" ? "never fetched" : `updated ${age.label}`}
          <RefreshPriceButton cardId={card.id} />
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="text-muted-foreground">No price available for this printing.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {lines.map(({ finish, usd }) => (
            <div key={finish} className="contents">
              <dt className="text-muted-foreground">{FINISH_LABELS[finish]}</dt>
              <dd className="text-right font-medium tabular-nums">{format(usd)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-muted-foreground mt-2 text-xs" data-testid="card-prices-source">
        {lines.length === 0
          ? `Prices in ${currency}`
          : `${PRICE_SOURCES[effectivePriceSource(quote?.prices)].name} prices in ${currency}`}
        {loading && configured !== currency ? ` (converting to ${configured}…)` : ""}
      </p>
    </section>
  );
}

function YourCopies({
  card,
  selection,
  quote
}: {
  card: SlimMtgCard;
  selection: SelectedCopies;
  quote: PriceQuote | null;
}) {
  const { format, currency } = useCurrency();
  // Live records for the selected ids, when card locations knows them.
  const { data: locations } = useCardLocations(card.name);
  const live = useMemo(() => {
    const wanted = new Set(selection.physicalCardIds);
    const found = (locations?.locations ?? [])
      .flatMap((l) => l.cards)
      .filter((c) => wanted.has(c._id));
    return found.length === selection.physicalCardIds.length ? found : null;
  }, [locations, selection.physicalCardIds]);

  const set: CopySet = live ? copySetFromCopies(live) : selection;
  const view = copyPriceView(set, quote);
  const count = selection.physicalCardIds.length;
  const text = view.usd === null ? "—" : format(view.usd);
  const attrs = `${FINISH_LABELS[set.finish]} · ${set.condition} (${CONDITION_LABELS[set.condition]})`;

  return (
    <div className="mb-3 border-b pb-3" data-testid="your-copies" data-price-kind={view.kind}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h4 className="font-semibold">
          {count === 1 ? "Your copy" : `Your ${count} copies`}
          {selection.locationName && (
            <span className="text-muted-foreground text-xs font-normal">
              {" "}
              in {selection.locationName}
            </span>
          )}
        </h4>
        {view.kind !== "proxy" && (
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs whitespace-nowrap">
            {view.kind === "copy" ? (
              <>
                <PriceAgeDot updatedAt={view.updatedAt} />
                {`updated ${priceAge(view.updatedAt).label}`}
              </>
            ) : (
              <>
                <PriceAgeDot
                  updatedAt={view.updatedAt}
                  override={{ level: "stale", description: ESTIMATED_PRICE_DESCRIPTION }}
                />
                estimated
              </>
            )}
            <RefreshPriceButton physicalCardIds={selection.physicalCardIds} />
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">{attrs}</span>
        <span className="text-right font-medium tabular-nums" data-testid="your-copies-price">
          {count > 1 && view.usd !== null ? `${text} ea` : text}
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-xs" data-testid="your-copies-detail">
        {view.kind === "proxy"
          ? `Proxy — counted as ${format(0)} regardless of market prices`
          : describeCopyPriceView(view, set, currency)}
      </p>
    </div>
  );
}

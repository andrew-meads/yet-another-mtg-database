"use client";

import { CardPrices } from "@/types/CardPrice";
import { CardFinish, FINISH_LABELS } from "@/lib/cardAttributes";
import { bestUsd, usdForFinish } from "@/lib/pricing";
import { priceSourceName } from "@/lib/priceSources";
import { useCurrency } from "@/hooks/useCurrency";
import PriceAgeDot from "./PriceAgeDot";
import RefreshPriceButton from "./RefreshPriceButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface PriceTagProps {
  prices?: CardPrices | null;
  /** When the prices were written; drives the age dot. */
  updatedAt?: Date | string | null;
  /**
   * Price a specific copy: use that finish's price only. Omit to show the
   * printing's most representative price (non-foil, else foil, else etched).
   */
  finish?: CardFinish;
  /** Multiply the unit price (for a grouped row of several copies). */
  quantity?: number;
  /** When given, an unobtrusive refresh icon re-fetches this card's prices on demand. */
  cardId?: string;
  className?: string;
}

/**
 * A formatted price in the user's currency with the price-age dot beside it.
 * Shows "—" (still with the dot, so the reader knows the data is just absent)
 * when there is no price for the requested finish. With a `cardId`, a small
 * refresh icon follows the dot.
 */
export default function PriceTag({
  prices,
  updatedAt,
  finish,
  quantity = 1,
  cardId,
  className
}: PriceTagProps) {
  const { format, currency } = useCurrency();

  let usd: number | null;
  let finishNote: string | null = null;
  if (finish) {
    usd = usdForFinish(prices, finish);
  } else {
    const best = bestUsd(prices);
    usd = best?.amount ?? null;
    if (best && best.finish !== "nonfoil") finishNote = FINISH_LABELS[best.finish];
  }
  const text = usd === null ? null : format(usd * quantity);

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums", className)}
      data-testid="price-tag"
    >
      {text === null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground">—</span>
          </TooltipTrigger>
          <TooltipContent>
            No {finish ? `${FINISH_LABELS[finish].toLowerCase()} ` : ""}price available from your
            price sources
          </TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{text}</span>
          </TooltipTrigger>
          <TooltipContent>
            {quantity > 1 ? `${quantity} × ${format(usd)} · ` : ""}
            {finishNote ? `${finishNote} price · ` : ""}
            {priceSourceName(prices)} price in {currency}
          </TooltipContent>
        </Tooltip>
      )}
      <PriceAgeDot updatedAt={updatedAt} />
      {cardId && <RefreshPriceButton cardId={cardId} />}
    </span>
  );
}

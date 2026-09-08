"use client";

import { PriceQuote } from "@/types/CardPrice";
import {
  ESTIMATED_PRICE_DESCRIPTION,
  copyPriceView,
  describeCopyPriceView
} from "@/lib/copyPricing";
import { CollectionGroupRow } from "@/components/my-cards-page/collection-view/grouping";
import { useCurrency } from "@/hooks/useCurrency";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import PriceAgeDot from "./PriceAgeDot";
import RefreshPriceButton from "./RefreshPriceButton";
import { cn } from "@/lib/utils";
import { FINISH_LABELS } from "@/lib/cardAttributes";

export { ESTIMATED_PRICE_DESCRIPTION };

interface CopyPriceTagProps {
  row: CollectionGroupRow;
  /** The printing's quote, used as the estimate when the copies were never priced. */
  quote?: PriceQuote | null;
  className?: string;
}

/**
 * The price cell of a collection row. Proxies (the "Proxy" tag) are always $0
 * with no age or refresh. Otherwise, when every copy in the row has been
 * priced for its finish and condition, that price is shown with its real age
 * and source; else the printing's finish-level price is shown as an estimate
 * and always marked stale. Either way the refresh icon prices the row's copies
 * for their own finish and condition. The decision itself is `copyPriceView`
 * (src/lib/copyPricing.ts), shared with the selected-card panel.
 */
export default function CopyPriceTag({ row, quote, className }: CopyPriceTagProps) {
  const { format, currency } = useCurrency();
  const view = copyPriceView(row, quote);

  if (view.kind === "proxy") {
    return (
      <span
        className={cn(
          "text-muted-foreground inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums",
          className
        )}
        data-testid="price-tag"
        data-price-kind="proxy"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{format(0)}</span>
          </TooltipTrigger>
          <TooltipContent>
            Proxy — counted as {format(0)} regardless of market prices
          </TooltipContent>
        </Tooltip>
      </span>
    );
  }

  const text = view.usd === null ? null : format(view.usd);
  const detail = describeCopyPriceView(view, row, currency);

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums", className)}
      data-testid="price-tag"
      data-price-kind={view.kind}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={text === null ? "text-muted-foreground" : undefined}>{text ?? "—"}</span>
        </TooltipTrigger>
        <TooltipContent>
          {text === null
            ? `No ${FINISH_LABELS[row.finish].toLowerCase()} price available from your price sources`
            : `${row.quantity > 1 ? `${row.quantity} × ${format(view.usd)} · ` : ""}${detail}`}
        </TooltipContent>
      </Tooltip>
      {view.kind === "copy" ? (
        <PriceAgeDot updatedAt={view.updatedAt} />
      ) : (
        <PriceAgeDot
          updatedAt={view.updatedAt}
          override={{ level: "stale", description: ESTIMATED_PRICE_DESCRIPTION }}
        />
      )}
      <RefreshPriceButton physicalCardIds={row.physicalCardIds} />
    </span>
  );
}

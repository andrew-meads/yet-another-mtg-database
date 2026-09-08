"use client";

import { RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRefreshCardPrices } from "@/hooks/react-query/useRefreshCardPrices";
import { useRefreshCopyPrices } from "@/hooks/react-query/useRefreshCopyPrices";
import { cn } from "@/lib/utils";

type RefreshPriceButtonProps = {
  className?: string;
} & (
  | { /** Refresh the printing's prices. */ cardId: string; physicalCardIds?: undefined }
  | {
      /** Refresh these copies' prices for their own finish + condition. */
      physicalCardIds: string[];
      cardId?: undefined;
    }
);

/**
 * A tiny, low-contrast refresh icon that re-fetches prices on demand — for a
 * printing (`cardId`) or for specific copies by their finish and condition
 * (`physicalCardIds`). Spins while the request is in flight; stops click
 * propagation so it never selects/opens the row it sits in.
 */
export default function RefreshPriceButton(props: RefreshPriceButtonProps) {
  const printing = useRefreshCardPrices();
  const copies = useRefreshCopyPrices();
  const isPending = printing.isPending || copies.isPending;
  const forCopies = props.physicalCardIds !== undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Refresh price"
          data-testid="refresh-price"
          disabled={isPending}
          onClick={(e) => {
            e.stopPropagation();
            if (props.physicalCardIds !== undefined) copies.mutate(props.physicalCardIds);
            else printing.mutate([props.cardId]);
          }}
          className={cn(
            "text-muted-foreground/50 hover:text-foreground focus-visible:ring-ring inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:cursor-default",
            isPending && "text-foreground",
            props.className
          )}
        >
          <RefreshCw className={cn("size-3", isPending && "animate-spin")} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {forCopies
          ? "Fetch the price for these copies' finish and condition now"
          : "Refresh this price from your price sources now"}
      </TooltipContent>
    </Tooltip>
  );
}

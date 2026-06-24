"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Package, Filter, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import AdvancedSearchDialog from "@/components/search/AdvancedSearchDialog";

export interface CardSearchBarProps {
  /** Initial text query. */
  initialQuery?: string;
  /** Emitted with the debounced query whenever it changes. */
  onQueryChange: (query: string) => void;
  /** Debounce delay for `onQueryChange` (ms). */
  debounceMs?: number;
  /** Render the "owned only" toggle (requires `owned` + `onOwnedChange`). */
  showOwned?: boolean;
  owned?: boolean;
  onOwnedChange?: (owned: boolean) => void;
  /** Render the "default filters" toggle (requires the corresponding props). */
  showDefaultFilters?: boolean;
  useDefaultFilters?: boolean;
  onDefaultFiltersChange?: (value: boolean) => void;
  compact?: boolean;
  className?: string;
}

/**
 * Shared Scryfall-style search bar: a text query input (debounced) plus an
 * "Advanced" button that opens {@link AdvancedSearchDialog} to build the query
 * string from fields. Optional owned / default-filter toggles are prop-gated so
 * the same component serves both the Card Search page and the Collection page.
 */
export default function CardSearchBar({
  initialQuery,
  onQueryChange,
  debounceMs = 350,
  showOwned = false,
  owned = false,
  onOwnedChange,
  showDefaultFilters = false,
  useDefaultFilters = false,
  onDefaultFiltersChange,
  compact,
  className
}: CardSearchBarProps) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const debouncedQ = useDebouncedValue(q, debounceMs);

  useEffect(() => {
    onQueryChange(debouncedQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Input
        id="search-q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={(e) => e.target.select()}
        placeholder={compact ? "Search..." : "Try: t:creature c:gr (flying or trample)"}
        className={compact ? "h-8" : undefined}
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setAdvancedOpen(true)}
            aria-label="Search builder"
          >
            <Wand2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Search builder</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setQ("")}
            disabled={q.length === 0}
            aria-label="Clear search"
          >
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Clear search</p>
        </TooltipContent>
      </Tooltip>

      {showOwned && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={owned ? "default" : "outline"}
              size="icon-sm"
              onClick={() => onOwnedChange?.(!owned)}
              aria-label="Filter to owned cards only"
            >
              <Package />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Owned cards only</p>
          </TooltipContent>
        </Tooltip>
      )}

      {showDefaultFilters && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={useDefaultFilters ? "default" : "outline"}
              size="icon-sm"
              onClick={() => onDefaultFiltersChange?.(!useDefaultFilters)}
              aria-label="Use default filters"
            >
              <Filter />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              Use default filters <em className="text-muted">(lang:en exclude:extra)</em>
            </p>
          </TooltipContent>
        </Tooltip>
      )}

      <AdvancedSearchDialog
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        onApply={(query) => setQ(query)}
      />
    </div>
  );
}

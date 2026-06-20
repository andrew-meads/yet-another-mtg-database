"use client";

import { Check } from "lucide-react";
import { SetSvg } from "@/components/SetSvg";
import { cn } from "@/lib/utils";
import { ScannedCard } from "@/types/ScanResult";
import { CardUiState, cropProxyUrl } from "./scanShared";

interface ScannedCardTileProps {
  card: ScannedCard;
  state: CardUiState;
  onOpen: () => void;
}

/**
 * One scanned card in the results overview grid: its de-skewed crop, the currently
 * selected (or best-guess) printing as a caption, and an added/unmatched status. Tapping
 * opens the detail sheet. The caption is prefixed with "Likely:" until the user has
 * actually added a printing for this card, after which it shows an "Added ×N" badge.
 */
export default function ScannedCardTile({ card, state, onOpen }: ScannedCardTileProps) {
  const hasMatches = card.matches.length > 0;
  const shown = hasMatches ? (card.matches[state.selectedIndex] ?? card.matches[0]) : null;
  const added = state.addedCount > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group bg-card hover:border-muted-foreground/40 focus-visible:ring-ring flex flex-col overflow-hidden rounded-lg border text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {/* De-skewed crop (proxied through the Next.js backend). */}
      <div className="bg-muted relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cropProxyUrl(card.url)} alt="Scanned card" className="h-auto w-full" />
        {added && (
          <div className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium shadow">
            <Check className="size-3" />×{state.addedCount}
          </div>
        )}
      </div>

      {/* Caption */}
      <div className="min-w-0 space-y-0.5 p-2">
        {shown ? (
          <>
            <p className="truncate text-sm font-medium">
              {!added && <span className="text-muted-foreground font-normal">Likely: </span>}
              {shown.name}
            </p>
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <SetSvg
                setCode={shown.set}
                rarityCode={shown.rarity}
                width={16}
                height={16}
                className="shrink-0"
              />
              <span className="truncate">
                {shown.set.toUpperCase()} #{shown.collector_number}
              </span>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground py-1 text-sm italic">No match</p>
        )}
        <p
          className={cn(
            "text-xs",
            added ? "text-primary font-medium" : "text-muted-foreground/70"
          )}
        >
          {added ? `Added ×${state.addedCount}` : hasMatches ? "Tap to choose" : "Tap to view"}
        </p>
      </div>
    </button>
  );
}

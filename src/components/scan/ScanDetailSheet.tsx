"use client";

import { Minus, Plus, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";
import { SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { SetSvg } from "@/components/SetSvg";
import { SimpleCardArtView } from "@/components/CardArtView";
import { cn } from "@/lib/utils";
import { ScannedCard } from "@/types/ScanResult";
import { CollectionSummary } from "@/types/Collection";
import { useCreatePhysicalCard } from "@/hooks/react-query/useCreatePhysicalCard";
import { cropProxyUrl } from "./scanShared";

interface ScanDetailSheetProps {
  card: ScannedCard;
  activeCollection: CollectionSummary | null;
  /** 1-based position of this card within the scan, for the "Card X of N" label. */
  current: number;
  total: number;
  selectedIndex: number;
  quantity: number;
  addedCount: number;
  onSelect: (index: number) => void;
  onQuantity: (quantity: number) => void;
  onAdded: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * The detail view for a single scanned card, rendered as the body of a bottom sheet:
 * paging header (Prev / "Card X of N" / Next), a de-skewed crop thumbnail that zooms on
 * tap, a full-width grid of candidate Scryfall printings (single-select), and a quantity
 * stepper + Add button that adds the chosen printing to the active collection. Fully
 * controlled — selection/quantity and paging live on the results page.
 */
export default function ScanDetailSheet({
  card,
  activeCollection,
  current,
  total,
  selectedIndex,
  quantity,
  addedCount,
  onSelect,
  onQuantity,
  onAdded,
  onPrev,
  onNext,
  hasPrev,
  hasNext
}: ScanDetailSheetProps) {
  const { mutate: createPhysicalCard, isPending } = useCreatePhysicalCard();

  const hasMatches = card.matches.length > 0;
  const selectedMatch = hasMatches ? (card.matches[selectedIndex] ?? card.matches[0]) : null;
  const cropUrl = cropProxyUrl(card.url);

  const handleAdd = () => {
    if (!activeCollection || !selectedMatch) return;

    createPhysicalCard(
      {
        cardId: selectedMatch.id,
        collectionId: activeCollection._id,
        quantity
      },
      {
        onSuccess: () => {
          onAdded();
          toast.success("Card added!", {
            description: `Added ${quantity}x ${selectedMatch.name} to ${activeCollection.name}`
          });
        },
        onError: (err) =>
          toast.error("Failed to add card", {
            description: err.message || "An error occurred while adding the card."
          })
      }
    );
  };

  return (
    <SheetContent side="bottom" className="h-[90dvh] gap-0 p-0">
      <SheetTitle className="sr-only">
        {selectedMatch ? selectedMatch.name : "Scanned card"}
      </SheetTitle>

      {/* Paging header (right padding leaves room for the sheet's close button) */}
      <div className="flex items-center justify-between border-b px-3 py-2 pr-12">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onPrev}
          disabled={!hasPrev}
          aria-label="Previous card"
        >
          <ChevronLeft className="size-4" />
          Prev
        </Button>
        <span className="text-muted-foreground text-sm font-medium">
          Card {current} of {total}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onNext}
          disabled={!hasNext}
          aria-label="Next card"
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        {/* Crop thumbnail (tap to zoom) + selected-match summary + controls */}
        <div className="flex items-start gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="focus-visible:ring-ring shrink-0 rounded-md focus-visible:ring-2 focus-visible:outline-none"
                aria-label="View scanned card crop"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cropUrl}
                  alt="Scanned card"
                  className="bg-muted h-24 w-auto rounded-md border object-contain sm:h-28"
                />
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogTitle className="sr-only">Scanned card crop</DialogTitle>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cropUrl}
                alt="Scanned card (enlarged)"
                className="bg-muted mx-auto max-h-[70vh] w-auto rounded-md object-contain"
              />
            </DialogContent>
          </Dialog>

          <div className="min-w-0 flex-1 space-y-2">
            {selectedMatch ? (
              <>
                <div className="min-w-0">
                  <p className="truncate font-medium">{selectedMatch.name}</p>
                  <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex shrink-0">
                          <SetSvg
                            setCode={selectedMatch.set}
                            rarityCode={selectedMatch.rarity}
                            width={20}
                            height={20}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {selectedMatch.set_name}{" "}
                        <em className="text-xs">({selectedMatch.set.toUpperCase()})</em>{" "}
                        {selectedMatch.rarity}
                      </TooltipContent>
                    </Tooltip>
                    <span className="truncate">
                      {selectedMatch.set.toUpperCase()} #{selectedMatch.collector_number} ·{" "}
                      <span className="capitalize">{selectedMatch.rarity}</span>
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => onQuantity(Math.max(1, quantity - 1))}
                      disabled={quantity <= 1}
                      aria-label="Decrease quantity"
                    >
                      <Minus className="size-4" />
                    </Button>
                    <span className="w-8 text-center font-medium tabular-nums">{quantity}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => onQuantity(quantity + 1)}
                      aria-label="Increase quantity"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    onClick={handleAdd}
                    disabled={!activeCollection || isPending}
                  >
                    {isPending ? "Adding…" : "Add"}
                  </Button>
                  {addedCount > 0 && (
                    <span className="text-primary inline-flex items-center gap-1 text-sm font-medium">
                      <Check className="size-4" />
                      Added ×{addedCount}
                    </span>
                  )}
                </div>

                {!activeCollection && (
                  <p className="text-muted-foreground text-sm italic">
                    No active collection. Open a collection to add cards.
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground py-6 text-sm">No matches found for this card.</p>
            )}
          </div>
        </div>

        {/* Candidate printings: full-width grid (no horizontal scroll). */}
        {hasMatches && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {card.matches.map((match, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={`${match.id}-${index}`}
                  type="button"
                  onClick={() => onSelect(index)}
                  title={`${match.name} (${match.set.toUpperCase()} #${match.collector_number})`}
                  aria-pressed={selected}
                  className={cn(
                    "overflow-hidden rounded-md border-2 text-left transition-colors",
                    selected
                      ? "border-primary ring-primary ring-2"
                      : "hover:border-muted-foreground/40 border-transparent"
                  )}
                >
                  <div className="bg-muted relative">
                    <SimpleCardArtView card={match} variant="normal" width="100%" height="auto" />
                    {selected && (
                      <div className="bg-primary text-primary-foreground absolute top-1 right-1 rounded-full p-0.5">
                        <Check className="size-3" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 p-1.5">
                    <SetSvg
                      setCode={match.set}
                      rarityCode={match.rarity}
                      width={18}
                      height={18}
                      className="shrink-0"
                    />
                    <span className="text-muted-foreground truncate text-[11px]">
                      {match.set.toUpperCase()} #{match.collector_number}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </SheetContent>
  );
}

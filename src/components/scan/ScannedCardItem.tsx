"use client";

import { useState } from "react";
import Image from "next/image";
import { Minus, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScannedCard } from "@/types/ScanResult";
import { CollectionSummary } from "@/types/CardCollection";
import { useUpdateCollectionCards } from "@/hooks/react-query/useUpdateCollectionCards";

/** Build the same-origin proxy URL for a scanner crop from its scanner-relative url. */
function cropProxyUrl(url: string): string {
  const file = url.split("/").pop() || "";
  return `/api/scan/crops/${file}`;
}

interface ScannedCardItemProps {
  card: ScannedCard;
  activeCollection: CollectionSummary | null;
}

/**
 * One detected card from a scan: its de-skewed crop, a horizontal strip of
 * candidate Scryfall printings (single-select, best match pre-selected), a
 * quantity stepper, and an Add button that adds the selection to the active
 * collection without leaving the page.
 */
export default function ScannedCardItem({ card, activeCollection }: ScannedCardItemProps) {
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const { mutate: updateCollectionCards, isPending } = useUpdateCollectionCards();

  const hasMatches = card.matches.length > 0;
  const selectedMatch = hasMatches ? card.matches[selectedMatchIndex] : null;

  const handleAdd = () => {
    if (!activeCollection || !selectedMatch) return;

    updateCollectionCards(
      {
        collectionId: activeCollection._id,
        action: "add",
        entry: { cardId: selectedMatch.scryfallId, quantity }
      },
      {
        onSuccess: () =>
          toast.success("Card added!", {
            description: `Added ${quantity}x ${selectedMatch.name} to ${activeCollection.name}`
          }),
        onError: (err) =>
          toast.error("Failed to add card", {
            description: err.message || "An error occurred while adding the card."
          })
      }
    );
  };

  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex gap-4">
        {/* De-skewed crop (proxied through the Next.js backend) */}
        <div className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cropProxyUrl(card.url)}
            alt="Scanned card"
            className="w-28 sm:w-32 rounded-md border bg-muted object-contain"
          />
        </div>

        {/* Candidates + controls */}
        <div className="flex-1 min-w-0 space-y-3">
          {hasMatches ? (
            <>
              {/* Candidate strip (scrolls horizontally on narrow screens) */}
              <div className="flex gap-2 overflow-x-auto pb-2">
                {card.matches.map((match, index) => {
                  const selected = index === selectedMatchIndex;
                  return (
                    <button
                      key={`${match.scryfallId}-${index}`}
                      type="button"
                      onClick={() => setSelectedMatchIndex(index)}
                      title={`${match.name} (${match.set.toUpperCase()} #${match.collectorNumber})`}
                      className={cn(
                        "shrink-0 w-24 rounded-md border-2 overflow-hidden text-left transition-colors",
                        selected
                          ? "border-primary ring-2 ring-primary"
                          : "border-transparent hover:border-muted-foreground/40"
                      )}
                    >
                      <div className="relative aspect-[488/680] bg-muted">
                        <Image
                          src={match.imageUrl}
                          alt={match.name}
                          fill
                          sizes="96px"
                          className="object-contain"
                        />
                        {selected && (
                          <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                      <div className="p-1">
                        <p className="text-xs font-medium truncate">{match.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {match.set.toUpperCase()} #{match.collectorNumber}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Quantity stepper + Add */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                    aria-label="Decrease quantity"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-8 text-center font-medium tabular-nums">{quantity}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setQuantity((q) => q + 1)}
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  type="button"
                  onClick={handleAdd}
                  disabled={!activeCollection || isPending}
                >
                  {isPending ? "Adding…" : "Add"}
                </Button>
              </div>

              {!activeCollection && (
                <p className="text-sm text-muted-foreground italic">
                  No active collection. Open a collection to add cards.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground py-8">No matches found for this card.</p>
          )}
        </div>
      </div>
    </div>
  );
}

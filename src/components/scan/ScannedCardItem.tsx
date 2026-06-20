"use client";

import { useState } from "react";
import Image from "next/image";
import { Minus, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScannedCard } from "@/types/ScanResult";
import { CollectionSummary } from "@/types/Collection";
import { useCreatePhysicalCard } from "@/hooks/react-query/useCreatePhysicalCard";

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
  const { mutate: createPhysicalCard, isPending } = useCreatePhysicalCard();

  const hasMatches = card.matches.length > 0;
  const selectedMatch = hasMatches ? card.matches[selectedMatchIndex] : null;

  const handleAdd = () => {
    if (!activeCollection || !selectedMatch) return;

    createPhysicalCard(
      {
        cardId: selectedMatch.scryfallId,
        collectionId: activeCollection._id,
        quantity
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
    <div className="bg-card rounded-lg border p-3 sm:p-4">
      <div className="flex gap-4">
        {/* De-skewed crop (proxied through the Next.js backend) */}
        <div className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cropProxyUrl(card.url)}
            alt="Scanned card"
            className="bg-muted w-28 rounded-md border object-contain sm:w-32"
          />
        </div>

        {/* Candidates + controls */}
        <div className="min-w-0 flex-1 space-y-3">
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
                        "w-24 shrink-0 overflow-hidden rounded-md border-2 text-left transition-colors",
                        selected
                          ? "border-primary ring-primary ring-2"
                          : "hover:border-muted-foreground/40 border-transparent"
                      )}
                    >
                      <div className="bg-muted relative aspect-[488/680]">
                        <Image
                          src={match.imageUrl}
                          alt={match.name}
                          fill
                          sizes="96px"
                          className="object-contain"
                        />
                        {selected && (
                          <div className="bg-primary text-primary-foreground absolute top-1 right-1 rounded-full p-0.5">
                            <Check className="size-3" />
                          </div>
                        )}
                      </div>
                      <div className="p-1">
                        <p className="truncate text-xs font-medium">{match.name}</p>
                        <p className="text-muted-foreground truncate text-[10px]">
                          {match.set.toUpperCase()} #{match.collectorNumber}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Quantity stepper + Add */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
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
                    onClick={() => setQuantity((q) => q + 1)}
                    aria-label="Increase quantity"
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
                <Button type="button" onClick={handleAdd} disabled={!activeCollection || isPending}>
                  {isPending ? "Adding…" : "Add"}
                </Button>
              </div>

              {!activeCollection && (
                <p className="text-muted-foreground text-sm italic">
                  No active collection. Open a collection to add cards.
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground py-8 text-sm">No matches found for this card.</p>
          )}
        </div>
      </div>
    </div>
  );
}

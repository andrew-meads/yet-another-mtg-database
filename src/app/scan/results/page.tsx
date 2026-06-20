"use client";

import { useCallback, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useScanContext } from "@/context/ScanContext";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import ScannedCardTile from "@/components/scan/ScannedCardTile";
import ScanDetailSheet from "@/components/scan/ScanDetailSheet";
import { CardUiState, defaultCardUiState } from "@/components/scan/scanShared";

/**
 * Scan Results Page
 *
 * Overview-first flow: every detected card is shown at once as a grid of de-skewed crops
 * with a best-guess ("Likely: …") caption and per-card status. Tapping a card opens a
 * bottom sheet to review candidate printings, pick one, set a quantity, and add it to the
 * active collection — with Prev/Next paging through the batch. Closing the page navigates
 * two entries back (past /scan) to wherever the user was before scanning.
 */
export default function ScanResultsPage() {
  const { scanResult } = useScanContext();
  const { activeCollection } = useOpenEntitiesContext();

  const cards = scanResult?.cards ?? [];

  // Per-card UI state, keyed by scanner card id, lifted here so it survives the sheet
  // closing/reopening and drives the overview tiles.
  const [cardStates, setCardStates] = useState<Record<string, CardUiState>>({});
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const stateFor = useCallback(
    (id: string): CardUiState => cardStates[id] ?? defaultCardUiState,
    [cardStates]
  );

  const updateState = useCallback(
    (id: string, patch: Partial<CardUiState>) =>
      setCardStates((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? defaultCardUiState), ...patch }
      })),
    []
  );

  const handleClose = () => {
    // Return past /scan to the page the user was on before scanning.
    window.history.go(-2);
  };

  const openCard = openIndex !== null ? cards[openIndex] : null;

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="bg-background/95 supports-backdrop-filter:bg-background/60 sticky top-0 z-10 border-b backdrop-blur">
        <div className="flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">Scan Results</h1>
            <p className="text-muted-foreground truncate text-sm">
              {activeCollection
                ? `Adding to: ${activeCollection.name}`
                : "No active collection selected"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose} className="shrink-0">
            <X className="size-5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {cards.length === 0 ? (
          <div className="text-muted-foreground space-y-4 py-16 text-center">
            <p>No cards were detected. Try another photo.</p>
            <Button variant="secondary" onClick={handleClose}>
              Go Back
            </Button>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-4">
            <p className="text-muted-foreground text-sm">
              Detected {cards.length} card{cards.length !== 1 ? "s" : ""}. Tap a card to choose a
              printing and add it.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {cards.map((card, index) => (
                <ScannedCardTile
                  key={card.id}
                  card={card}
                  state={stateFor(card.id)}
                  onOpen={() => setOpenIndex(index)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Detail sheet (paging swaps content within one open sheet) */}
      <Sheet open={openIndex !== null} onOpenChange={(open) => !open && setOpenIndex(null)}>
        {openCard && openIndex !== null && (
          <ScanDetailSheet
            card={openCard}
            activeCollection={activeCollection}
            current={openIndex + 1}
            total={cards.length}
            selectedIndex={stateFor(openCard.id).selectedIndex}
            quantity={stateFor(openCard.id).quantity}
            addedCount={stateFor(openCard.id).addedCount}
            onSelect={(selectedIndex) => updateState(openCard.id, { selectedIndex })}
            onQuantity={(quantity) => updateState(openCard.id, { quantity })}
            onAdded={() =>
              updateState(openCard.id, {
                addedCount: stateFor(openCard.id).addedCount + stateFor(openCard.id).quantity
              })
            }
            onPrev={() => setOpenIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
            onNext={() => setOpenIndex((i) => (i !== null && i < cards.length - 1 ? i + 1 : i))}
            hasPrev={openIndex > 0}
            hasNext={openIndex < cards.length - 1}
          />
        )}
      </Sheet>
    </div>
  );
}

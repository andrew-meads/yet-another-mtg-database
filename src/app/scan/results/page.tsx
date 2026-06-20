"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScanContext } from "@/context/ScanContext";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import ScannedCardItem from "@/components/scan/ScannedCardItem";

/**
 * Scan Results Page
 *
 * Renders each card detected by the scanner: its de-skewed crop, a selectable
 * strip of candidate Scryfall printings, and controls to add the chosen printing
 * to the active collection. Closing navigates two entries back (past /scan) to
 * wherever the user was before scanning.
 */
export default function ScanResultsPage() {
  const { scanResult } = useScanContext();
  const { activeCollection } = useOpenEntitiesContext();

  const cards = scanResult?.cards ?? [];

  const handleClose = () => {
    // Return past /scan to the page the user was on before scanning.
    window.history.go(-2);
  };

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
          <div className="mx-auto max-w-3xl space-y-4">
            <p className="text-muted-foreground text-sm">
              Detected {cards.length} card{cards.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-3">
              {cards.map((card) => (
                <ScannedCardItem key={card.id} card={card} activeCollection={activeCollection} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

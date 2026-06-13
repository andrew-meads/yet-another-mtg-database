"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScanContext } from "@/context/ScanContext";
import { useOpenCollectionsContext } from "@/context/OpenCollectionsContext";
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
  const { activeCollection } = useOpenCollectionsContext();

  const cards = scanResult?.cards ?? [];

  const handleClose = () => {
    // Return past /scan to the page the user was on before scanning.
    window.history.go(-2);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 border-b">
        <div className="flex items-center gap-3 p-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">Scan Results</h1>
            <p className="text-sm text-muted-foreground truncate">
              {activeCollection
                ? `Adding to: ${activeCollection.name}`
                : "No active collection selected"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose} className="shrink-0">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {cards.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground space-y-4">
            <p>No cards were detected. Try another photo.</p>
            <Button variant="secondary" onClick={handleClose}>
              Go Back
            </Button>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            <p className="text-sm text-muted-foreground">
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

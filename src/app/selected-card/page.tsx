"use client";

import { useCardSelection } from "@/context/CardSelectionContext";
import { useRouter } from "next/navigation";
import CardArtView from "@/components/CardArtView";
import { CardTextView } from "@/components/CardTextView";
import CardLocationsView from "@/components/CardLocationsView";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

/**
 * SelectedCardPage Component
 *
 * Mobile-friendly page for viewing a selected card's details.
 * Displays the card's artwork, locations, and text information.
 * Shows a message if no card is selected.
 */
export default function SelectedCardPage() {
  const { selectedCard } = useCardSelection();
  const router = useRouter();

  if (!selectedCard) {
    return (
      <div className="h-screen w-full grid place-items-center text-muted-foreground p-4">
        <div className="text-center space-y-4">
          <div className="font-semibold text-lg">No Card Selected</div>
          <div className="text-sm">Select a card from search to view its details</div>
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header with back button */}
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-semibold text-lg truncate">
            {selectedCard.flavor_name || selectedCard.name}
          </h1>
        </div>
      </div>

      {/* Card details */}
      <div className="overflow-y-auto space-y-4 p-4">
        {/* Card Image */}
        <div className="w-full aspect-5/7 max-w-md mx-auto">
          <CardArtView
            card={selectedCard}
            variant="large"
            flippable={true}
            draggable={false}
            width="100%"
            height="100%"
          />
        </div>

        {/* Card Locations */}
        <div>
          <h3 className="font-semibold text-sm mb-2">Locations</h3>
          <CardLocationsView cardName={selectedCard.name} />
        </div>

        {/* Card Text */}
        <div>
          <CardTextView card={selectedCard} />
        </div>
      </div>
    </div>
  );
}

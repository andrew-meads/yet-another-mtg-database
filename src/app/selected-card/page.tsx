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
      <div className="text-muted-foreground grid h-screen w-full place-items-center p-4">
        <div className="space-y-4 text-center">
          <div className="text-lg font-semibold">No Card Selected</div>
          <div className="text-sm">Select a card from search to view its details</div>
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 size-4" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      {/* Header with back button */}
      <div className="bg-background sticky top-0 z-10 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="size-5" />
          </Button>
          <h1 className="truncate text-lg font-semibold">
            {selectedCard.flavor_name || selectedCard.name}
          </h1>
        </div>
      </div>

      {/* Card details */}
      <div className="space-y-4 overflow-y-auto p-4">
        {/* Card Image */}
        <div className="mx-auto aspect-5/7 w-full max-w-md">
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
          <h3 className="mb-2 text-sm font-semibold">Locations</h3>
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

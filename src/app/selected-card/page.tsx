"use client";

import { useCardSelection } from "@/context/CardSelectionContext";
import { useRouter } from "next/navigation";
import CardDetailsPanel from "@/components/card-details/CardDetailsPanel";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useMounted } from "@/hooks/useMounted";

/**
 * SelectedCardPage Component
 *
 * Mobile-friendly page for viewing a selected card's details.
 * Displays the card's artwork above the tabbed text / copies / prices details.
 * Shows a message if no card is selected.
 *
 * The selection (and the remembered details tab) live in localStorage, which
 * the server can't see, so the page renders a blank frame until mounted — the
 * server HTML and the hydrating client then agree instead of React throwing a
 * hydration mismatch and rebuilding the tree.
 */
export default function SelectedCardPage() {
  const { selectedCard } = useCardSelection();
  const router = useRouter();
  const mounted = useMounted();

  if (!mounted) {
    return <div className="bg-background min-h-screen" data-testid="selected-card-hydrating" />;
  }

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

      {/* Card details: image, then the Text / Copies / Prices tabs (shared with desktop) */}
      <div className="overflow-y-auto p-4">
        <CardDetailsPanel card={selectedCard} layout="stack" />
      </div>
    </div>
  );
}

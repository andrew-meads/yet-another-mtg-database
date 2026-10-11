"use client";

import { DeckWithCards } from "@/types/Deck";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import DeckSection from "./DeckSection";
import { useAddSection, useReorderSections } from "@/hooks/react-query/useDeckSections";
import { useDeckNewSectionDropTarget } from "@/hooks/drag-drop/useDeckDropTargets";
import { ZOOM_DEFAULT } from "@/lib/deckZoom";
import { DeckZoomProvider } from "./DeckZoomContext";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

interface DeckViewProps {
  deck: DeckWithCards;
  /** Card zoom percent (20–200); defaults to 100. */
  zoom?: number;
}

function NewSectionDropZone({ deckId }: { deckId: string }) {
  const { dropRef, isOver } = useDeckNewSectionDropTarget(deckId);
  return (
    <div
      ref={dropRef}
      className={cn(
        "text-muted-foreground flex h-12 min-w-40 flex-1 items-center justify-center rounded-md border-2 border-dashed text-xs transition-colors",
        isOver ? "border-primary bg-primary/10" : "border-muted-foreground/30"
      )}
    >
      Drop here to create a new section
    </div>
  );
}

export default function DeckView({ deck, zoom = ZOOM_DEFAULT }: DeckViewProps) {
  const addSection = useAddSection();
  const reorderSections = useReorderSections();
  const { mutate: reorder } = reorderSections;
  const deckId = deck._id;

  const sectionIds = useMemo(() => deck.sections.map((s) => s._id), [deck.sections]);
  const handleReorder = useCallback(
    (order: string[]) =>
      reorder(
        { deckId, order },
        {
          onError: (error) =>
            toast.error("Failed to reorder sections", { description: error.message })
        }
      ),
    [reorder, deckId]
  );

  return (
    <DeckZoomProvider zoom={zoom}>
      <div className="h-full space-y-8 overflow-auto rounded-md border p-4">
        <div>
          {deck.sections.map((section) => (
            <DeckSection
              key={section._id}
              deckId={deck._id}
              deckName={deck.name}
              section={section}
              sectionIds={sectionIds}
              onReorderSections={handleReorder}
            />
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="outline"
            className="shrink-0 gap-2"
            onClick={() => addSection.mutate({ deckId: deck._id, name: "New Section" })}
          >
            <Plus className="size-4" />
            Add section
          </Button>
          <NewSectionDropZone deckId={deck._id} />
        </div>
      </div>
    </DeckZoomProvider>
  );
}

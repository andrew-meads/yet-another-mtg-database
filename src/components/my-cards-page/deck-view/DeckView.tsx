"use client";

import { DeckWithCards } from "@/types/Deck";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import DeckSection from "./DeckSection";
import { useAddSection } from "@/hooks/react-query/useDeckSections";
import { useDeckNewSectionDropTarget } from "@/hooks/drag-drop/useDeckDropTargets";

interface DeckViewProps {
  deck: DeckWithCards;
}

function NewSectionDropZone({ deckId }: { deckId: string }) {
  const { dropRef, isOver } = useDeckNewSectionDropTarget(deckId);
  return (
    <div
      ref={dropRef}
      className={cn(
        "flex-1 min-w-40 h-12 rounded-md border-2 border-dashed flex items-center justify-center text-xs text-muted-foreground transition-colors",
        isOver ? "border-primary bg-primary/10" : "border-muted-foreground/30"
      )}
    >
      Drop here to create a new section
    </div>
  );
}

export default function DeckView({ deck }: DeckViewProps) {
  const addSection = useAddSection();

  return (
    <div className="h-full rounded-md border overflow-auto p-4 space-y-8">
      {deck.sections.map((section) => (
        <DeckSection key={section._id} deckId={deck._id} section={section} />
      ))}

      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="outline"
          className="gap-2 shrink-0"
          onClick={() => addSection.mutate({ deckId: deck._id, name: "New Section" })}
        >
          <Plus className="h-4 w-4" />
          Add section
        </Button>
        <NewSectionDropZone deckId={deck._id} />
      </div>
    </div>
  );
}

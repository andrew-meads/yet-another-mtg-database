"use client";

import { DeckSection as DeckSectionData } from "@/types/Deck";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import DeckColumn from "./DeckColumn";
import { useUpdateSection, useDeleteSection } from "@/hooks/react-query/useDeckSections";
import { useAddColumn } from "@/hooks/react-query/useDeckColumns";
import { useDeckNewColumnDropTarget } from "@/hooks/drag-drop/useDeckDropTargets";
import { CARD_WIDTH, CARD_HEIGHT } from "./card-dimensions";

interface DeckSectionProps {
  deckId: string;
  section: DeckSectionData;
}

function NewColumnDropZone({ deckId, sectionId }: { deckId: string; sectionId: string }) {
  const { dropRef, isOver } = useDeckNewColumnDropTarget(deckId, sectionId);
  return (
    <div
      ref={dropRef}
      className={cn(
        "shrink-0 rounded-md border-2 border-dashed flex items-center justify-center text-xs text-muted-foreground transition-colors",
        isOver ? "border-primary bg-primary/10" : "border-muted-foreground/30"
      )}
      style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px` }}
    >
      New column
    </div>
  );
}

export default function DeckSection({ deckId, section }: DeckSectionProps) {
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const addColumn = useAddColumn();

  const [name, setName] = useState(section.name);
  useEffect(() => setName(section.name), [section.name]);

  const isEmpty = section.columns.every((c) => c.cards.length === 0);

  const commitName = () => {
    if (name.trim() && name !== section.name) {
      updateSection.mutate({ deckId, sectionId: section._id, name: name.trim() });
    } else {
      setName(section.name);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-8 w-auto min-w-40 max-w-80 font-semibold"
        />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => addColumn.mutate({ deckId, sectionId: section._id })}
        >
          <Plus className="h-4 w-4" />
          Column
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!isEmpty}
          title={isEmpty ? "Delete section" : "Empty the section first"}
          onClick={() => deleteSection.mutate({ deckId, sectionId: section._id })}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-row flex-wrap items-start gap-3">
        {section.columns.map((column) => (
          <DeckColumn key={column._id} deckId={deckId} sectionId={section._id} column={column} />
        ))}
        <NewColumnDropZone deckId={deckId} sectionId={section._id} />
      </div>
    </div>
  );
}

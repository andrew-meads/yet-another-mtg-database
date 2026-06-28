"use client";

import { DeckSection as DeckSectionData } from "@/types/Deck";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import DeckColumn from "./DeckColumn";
import AddBasicLandButton from "./AddBasicLandButton";
import { useUpdateSection, useDeleteSection } from "@/hooks/react-query/useDeckSections";
import { useAddColumn } from "@/hooks/react-query/useDeckColumns";
import { useDeckNewColumnDropTarget } from "@/hooks/drag-drop/useDeckDropTargets";
import { CARD_WIDTH, CARD_HEIGHT } from "./card-dimensions";

interface DeckSectionProps {
  deckId: string;
  deckName?: string;
  section: DeckSectionData;
}

function NewColumnDropZone({ deckId, sectionId }: { deckId: string; sectionId: string }) {
  const { dropRef, isOver } = useDeckNewColumnDropTarget(deckId, sectionId);
  return (
    <div ref={dropRef} className="shrink-0 rounded-[5px] border border-transparent p-1">
      <div
        className={cn(
          "text-muted-foreground flex items-center justify-center rounded-md border-2 border-dashed text-xs transition-colors",
          isOver ? "border-primary bg-primary/10" : "border-muted-foreground/30"
        )}
        style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px` }}
      >
        New column
      </div>
    </div>
  );
}

export default function DeckSection({ deckId, deckName, section }: DeckSectionProps) {
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const addColumn = useAddColumn();

  const [name, setName] = useState(section.name);
  // eslint-disable-next-line react-hooks/set-state-in-effect
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
          className="h-8 w-auto max-w-80 min-w-40 font-semibold"
        />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => addColumn.mutate({ deckId, sectionId: section._id })}
        >
          <Plus className="size-4" />
          Column
        </Button>
        <AddBasicLandButton deckId={deckId} sectionId={section._id} />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={!isEmpty}
          title={isEmpty ? "Delete section" : "Empty the section first"}
          onClick={() => deleteSection.mutate({ deckId, sectionId: section._id })}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="flex flex-row flex-wrap items-start gap-3">
        {section.columns.map((column) => (
          <DeckColumn
            key={column._id}
            deckId={deckId}
            deckName={deckName}
            sectionId={section._id}
            column={column}
          />
        ))}
        <NewColumnDropZone deckId={deckId} sectionId={section._id} />
      </div>
    </div>
  );
}

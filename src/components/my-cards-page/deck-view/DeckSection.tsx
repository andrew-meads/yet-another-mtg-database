"use client";

import { DeckSection as DeckSectionData } from "@/types/Deck";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDownWideNarrow, GripVertical, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import DeckColumn from "./DeckColumn";
import AddBasicLandButton from "./AddBasicLandButton";
import {
  useUpdateSection,
  useDeleteSection,
  useSortSection
} from "@/hooks/react-query/useDeckSections";
import { useAddColumn } from "@/hooks/react-query/useDeckColumns";
import { useDeckNewColumnDropTarget } from "@/hooks/drag-drop/useDeckDropTargets";
import {
  useDeckSectionDragSource,
  useDeckSectionDropTarget
} from "@/hooks/drag-drop/useDeckSectionDrag";
import {
  DECK_SECTION_KIND_LABELS,
  countSectionCards,
  effectiveSectionKind,
  formatCardCount,
  isDeckSectionKind
} from "@/lib/deckUtils";
import { DECK_SECTION_KINDS } from "@/types/Deck";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useDeckCardDimensions } from "./DeckZoomContext";
import { PLACEHOLDER_LABEL_MIN_ZOOM } from "@/lib/deckZoom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { SECTION_SORT_MODES, SECTION_SORT_MODE_LABELS } from "@/lib/deckSectionSort";

interface DeckSectionProps {
  deckId: string;
  deckName?: string;
  section: DeckSectionData;
  /** Every section id of the deck, in order (drives drag-to-reorder). */
  sectionIds?: string[];
  /** Saves a new section order; dragging is disabled without it. */
  onReorderSections?: (order: string[]) => void;
}

const NO_SECTION_IDS: string[] = [];
const noReorder = () => {};

function NewColumnDropZone({ deckId, sectionId }: { deckId: string; sectionId: string }) {
  const { dropRef, isOver } = useDeckNewColumnDropTarget(deckId, sectionId);
  const { scale, cardWidth, cardHeight } = useDeckCardDimensions();
  return (
    <div ref={dropRef} className="shrink-0 rounded-[5px] border border-transparent p-1">
      <div
        className={cn(
          "text-muted-foreground flex items-center justify-center overflow-hidden rounded-md border-2 border-dashed text-center text-xs transition-colors",
          isOver ? "border-primary bg-primary/10" : "border-muted-foreground/30"
        )}
        style={{ width: `${cardWidth}px`, height: `${cardHeight}px` }}
      >
        {scale * 100 >= PLACEHOLDER_LABEL_MIN_ZOOM && "New column"}
      </div>
    </div>
  );
}

export default function DeckSection({
  deckId,
  deckName,
  section,
  sectionIds = NO_SECTION_IDS,
  onReorderSections
}: DeckSectionProps) {
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const addColumn = useAddColumn();
  const sortSection = useSortSection();
  const { columnGap } = useDeckCardDimensions();
  const { isDragging, dragRef, previewRef } = useDeckSectionDragSource(deckId, section._id);
  const { dropRef, dropPosition } = useDeckSectionDropTarget({
    deckId,
    sectionId: section._id,
    sectionIds,
    onReorder: onReorderSections ?? noReorder
  });
  const canReorder = !!onReorderSections && sectionIds.length > 1;

  const [name, setName] = useState(section.name);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setName(section.name), [section.name]);

  const cardCount = countSectionCards(section);
  const isEmpty = cardCount === 0;
  const kind = effectiveSectionKind(section.kind);

  const commitName = () => {
    if (name.trim() && name !== section.name) {
      updateSection.mutate({ deckId, sectionId: section._id, name: name.trim() });
    } else {
      setName(section.name);
    }
  };

  return (
    // Sections are spaced with padding rather than margins so the gap between two
    // sections still belongs to one of them as a drop target.
    <div
      ref={dropRef}
      className={cn("relative space-y-2 py-4 first:pt-0 last:pb-0", isDragging && "opacity-40")}
      data-testid={`deck-section-${section._id}`}
    >
      {dropPosition && (
        <div
          aria-hidden
          data-testid={`section-drop-indicator-${dropPosition}`}
          className={cn(
            "bg-primary pointer-events-none absolute inset-x-0 z-10 my-0 h-1 rounded-full",
            dropPosition === "before" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2"
          )}
        />
      )}
      <div ref={previewRef} className="flex items-center gap-2">
        {canReorder && (
          <button
            type="button"
            ref={dragRef}
            aria-label={`Drag to reorder section ${section.name}`}
            title="Drag to reorder sections"
            data-testid={`section-drag-handle-${section._id}`}
            className="text-muted-foreground hover:text-foreground -mr-1 flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded-sm active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-8 w-auto max-w-80 min-w-40 font-semibold"
        />
        <Select
          value={kind}
          onValueChange={(v) =>
            isDeckSectionKind(v) &&
            v !== kind &&
            updateSection.mutate({ deckId, sectionId: section._id, kind: v })
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Section type"
            title="Normal sections count toward the deck, sideboards toward the sideboard, scratch areas not at all"
            data-testid={`section-kind-select-${section._id}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DECK_SECTION_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {DECK_SECTION_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span
          className="text-muted-foreground shrink-0 text-sm tabular-nums"
          data-testid={`section-card-count-${section._id}`}
        >
          {formatCardCount(cardCount)}
          {kind === "sideboard" && " in sideboard"}
          {kind === "scratch" && " (not counted)"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => addColumn.mutate({ deckId, sectionId: section._id })}
        >
          <Plus className="size-4" />
          Column
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              disabled={isEmpty || sortSection.isPending}
              title="Sort this section into columns"
              data-testid={`section-sort-${section._id}`}
            >
              <ArrowDownWideNarrow className="size-4" />
              Sort
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {SECTION_SORT_MODES.map((mode) => (
              <DropdownMenuItem
                key={mode}
                data-testid={`section-sort-${mode}`}
                onSelect={() => sortSection.mutate({ deckId, sectionId: section._id, mode })}
              >
                {SECTION_SORT_MODE_LABELS[mode]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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

      <div className="flex flex-row flex-wrap items-start" style={{ gap: `${columnGap}px` }}>
        {section.columns.map((column) => (
          <DeckColumn
            key={column._id}
            deckId={deckId}
            deckName={deckName}
            sectionId={section._id}
            column={column}
            muted={kind === "scratch"}
          />
        ))}
        <NewColumnDropZone deckId={deckId} sectionId={section._id} />
      </div>
    </div>
  );
}

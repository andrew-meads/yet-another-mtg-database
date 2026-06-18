import React, { useEffect, useState } from "react";
import { Input } from "../ui/input";
import TagInput from "../TagInput";
import { useUpdatePhysicalCard } from "@/hooks/react-query/useUpdatePhysicalCard";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRetrieveTags } from "@/hooks/react-query/useRetrieveTags";

interface EntryNotesAndTagsProps {
  notes?: string;
  tags?: string[];
  /** All physical cards in this grouped row — edits apply to every copy. */
  physicalCardIds: string[];
}

/**
 * Editor for a grouped row's shared notes/tags. Applies changes to every physical
 * card in the group so they stay grouped together.
 */
export default function EntryNotesAndTags({ notes, tags, physicalCardIds }: EntryNotesAndTagsProps) {
  const { mutate: updateCard } = useUpdatePhysicalCard();
  const [localNotes, setLocalNotes] = useState(notes || "");
  const debouncedNotes = useDebouncedValue(localNotes, 500);
  const { data: predefinedTags = [] } = useRetrieveTags();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalNotes(notes || "");
  }, [notes]);

  useEffect(() => {
    if (debouncedNotes !== (notes || "")) {
      physicalCardIds.forEach((physicalCardId) =>
        updateCard({ physicalCardId, notes: debouncedNotes })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedNotes]);

  const handleNotesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalNotes(e.target.value);
  };

  const handleTagsChange = (newTags: string[]) => {
    physicalCardIds.forEach((physicalCardId) => updateCard({ physicalCardId, tags: newTags }));
  };

  return (
    <div className="grid grid-cols-[auto_1fr_auto_1fr] items-baseline gap-x-4">
      <span className="font-semibold">Notes:</span>
      <Input value={localNotes} placeholder="Your notes here" onChange={handleNotesChange} />
      <span className="font-semibold">Tags:</span>
      <TagInput value={tags || []} predefinedTags={predefinedTags} onChange={handleTagsChange} />
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { Input } from "../ui/input";
import TagInput from "../TagInput";
import { useUpdateCardEntry } from "@/hooks/react-query/useUpdateCardEntry";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRetrieveTags } from "@/hooks/react-query/useRetrieveTags";

interface EntryNotesAndTagsProps {
  notes?: string;
  tags?: string[];
  collectionId: string;
  cardIndex: number;
}

export default function EntryNotesAndTags({
  notes,
  tags,
  collectionId,
  cardIndex
}: EntryNotesAndTagsProps) {
  const { mutate: updateEntry } = useUpdateCardEntry();
  const [localNotes, setLocalNotes] = useState(notes || "");
  const debouncedNotes = useDebouncedValue(localNotes, 500);
  const { data: predefinedTags = [] } = useRetrieveTags();

  useEffect(() => {
    setLocalNotes(notes || "");
  }, [notes]);

  useEffect(() => {
    if (debouncedNotes !== notes) {
      updateEntry({ collectionId, cardIndex, notes: debouncedNotes });
    }
  }, [debouncedNotes]);

  const handleNotesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalNotes(e.target.value);
  };

  const handleTagsChange = (newTags: string[]) => {
    updateEntry({
      collectionId,
      cardIndex,
      tags: newTags
    });
  };

  return (
    <div className="grid grid-cols-[auto_1fr_auto_1fr] items-baseline gap-x-4">
      <span className="font-semibold">Notes:</span>
      <Input value={localNotes} placeholder="Your notes here" onChange={handleNotesChange} />
      <span className="font-semibold">Tags:</span>
      <TagInput
        value={tags || []}
        predefinedTags={predefinedTags}
        onChange={handleTagsChange}
      />
    </div>
  );
}

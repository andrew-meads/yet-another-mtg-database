import React, { useEffect, useState } from "react";
import { Input } from "../ui/input";
import TagInput from "../TagInput";
import CardAttributePickers from "@/components/CardAttributePickers";
import { useUpdatePhysicalCard } from "@/hooks/react-query/useUpdatePhysicalCard";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRetrieveTags } from "@/hooks/react-query/useRetrieveTags";
import { CardCondition, CardFinish } from "@/lib/cardAttributes";

interface EntryDetailsEditorProps {
  notes?: string;
  tags?: string[];
  finish: CardFinish;
  condition: CardCondition;
  /** All physical cards in this grouped row — edits apply to every copy. */
  physicalCardIds: string[];
}

/**
 * Editor for a grouped row's shared notes, tags, finish, and condition. Applies
 * changes to every physical card in the group so they stay grouped together.
 */
export default function EntryDetailsEditor({
  notes,
  tags,
  finish,
  condition,
  physicalCardIds
}: EntryDetailsEditorProps) {
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

  const handleFinishChange = (newFinish: CardFinish) => {
    if (newFinish === finish) return;
    physicalCardIds.forEach((physicalCardId) => updateCard({ physicalCardId, finish: newFinish }));
  };

  const handleConditionChange = (newCondition: CardCondition) => {
    if (newCondition === condition) return;
    physicalCardIds.forEach((physicalCardId) =>
      updateCard({ physicalCardId, condition: newCondition })
    );
  };

  return (
    <div className="grid grid-cols-[auto_1fr_auto_1fr_auto_auto] items-baseline gap-x-4">
      <span className="font-semibold">Notes:</span>
      <Input value={localNotes} placeholder="Your notes here" onChange={handleNotesChange} />
      <span className="font-semibold">Tags:</span>
      <TagInput value={tags || []} predefinedTags={predefinedTags} onChange={handleTagsChange} />
      <span className="font-semibold">Finish / condition:</span>
      <CardAttributePickers
        finish={finish}
        condition={condition}
        onFinishChange={handleFinishChange}
        onConditionChange={handleConditionChange}
      />
    </div>
  );
}

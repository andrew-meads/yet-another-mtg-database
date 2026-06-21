"use client";

import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import TagInput from "@/components/TagInput";
import { useSearchAddMeta } from "@/context/SearchAddMetaContext";
import { useRetrieveTags } from "@/hooks/react-query/useRetrieveTags";

export default function SearchAddMetaInput() {
  const { notes, tags, setNotes, setTags } = useSearchAddMeta();
  const { data: predefinedTags = [] } = useRetrieveTags();

  return (
    <FieldGroup className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>Notes (applied on add)</FieldLabel>
          <FieldContent>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. foil, signed..."
            />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>Tags (applied on add)</FieldLabel>
          <FieldContent>
            <TagInput value={tags} predefinedTags={predefinedTags} onChange={setTags} />
          </FieldContent>
        </Field>
      </div>
    </FieldGroup>
  );
}

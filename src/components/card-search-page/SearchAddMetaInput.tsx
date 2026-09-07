"use client";

import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import TagInput from "@/components/TagInput";
import CardAttributePickers from "@/components/CardAttributePickers";
import { useSearchAddMeta } from "@/context/SearchAddMetaContext";
import { useRetrieveTags } from "@/hooks/react-query/useRetrieveTags";

export default function SearchAddMetaInput() {
  const { notes, tags, finish, condition, setNotes, setTags, setFinish, setCondition } =
    useSearchAddMeta();
  const { data: predefinedTags = [] } = useRetrieveTags();

  return (
    <FieldGroup className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
        <Field>
          <FieldLabel>Notes (applied on add)</FieldLabel>
          <FieldContent>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. signed, altered..."
            />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>Tags (applied on add)</FieldLabel>
          <FieldContent>
            <TagInput value={tags} predefinedTags={predefinedTags} onChange={setTags} />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>Finish &amp; condition (applied on add)</FieldLabel>
          <FieldContent>
            <CardAttributePickers
              finish={finish}
              condition={condition}
              onFinishChange={setFinish}
              onConditionChange={setCondition}
            />
          </FieldContent>
        </Field>
      </div>
    </FieldGroup>
  );
}

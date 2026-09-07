"use client";

import { createContext, useContext, useMemo, useState } from "react";
import {
  CardCondition,
  CardFinish,
  DEFAULT_CONDITION,
  DEFAULT_FINISH,
  sparseAttributes
} from "@/lib/cardAttributes";
import { NewCopyMeta } from "@/types/PhysicalCard";

interface SearchAddMetaContextType {
  notes: string;
  tags: string[];
  finish: CardFinish;
  condition: CardCondition;
  setNotes: (notes: string) => void;
  setTags: (tags: string[]) => void;
  setFinish: (finish: CardFinish) => void;
  setCondition: (condition: CardCondition) => void;
  /**
   * The current values as create-request fields, with empty notes/tags and
   * default finish/condition omitted — spread this into a create call.
   */
  createFields: NewCopyMeta;
}

const SearchAddMetaContext = createContext<SearchAddMetaContextType | undefined>(undefined);

/** Builds the sparse create-request fields from the raw add-meta values. */
export function buildCreateFields(
  notes: string,
  tags: string[],
  finish: CardFinish,
  condition: CardCondition
): NewCopyMeta {
  return {
    notes: notes || undefined,
    tags: tags.length ? tags : undefined,
    ...sparseAttributes(finish, condition)
  };
}

export function SearchAddMetaProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [finish, setFinish] = useState<CardFinish>(DEFAULT_FINISH);
  const [condition, setCondition] = useState<CardCondition>(DEFAULT_CONDITION);

  const value = useMemo<SearchAddMetaContextType>(
    () => ({
      notes,
      tags,
      finish,
      condition,
      setNotes,
      setTags,
      setFinish,
      setCondition,
      createFields: buildCreateFields(notes, tags, finish, condition)
    }),
    [notes, tags, finish, condition]
  );

  return <SearchAddMetaContext.Provider value={value}>{children}</SearchAddMetaContext.Provider>;
}

const FALLBACK: SearchAddMetaContextType = {
  notes: "",
  tags: [],
  finish: DEFAULT_FINISH,
  condition: DEFAULT_CONDITION,
  setNotes: () => {},
  setTags: () => {},
  setFinish: () => {},
  setCondition: () => {},
  createFields: {}
};

export function useSearchAddMeta(): SearchAddMetaContextType {
  return useContext(SearchAddMetaContext) ?? FALLBACK;
}

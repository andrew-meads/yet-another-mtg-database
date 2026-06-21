"use client";

import { createContext, useContext, useState } from "react";

interface SearchAddMetaContextType {
  notes: string;
  tags: string[];
  setNotes: (notes: string) => void;
  setTags: (tags: string[]) => void;
}

const SearchAddMetaContext = createContext<SearchAddMetaContextType | undefined>(undefined);

export function SearchAddMetaProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  return (
    <SearchAddMetaContext.Provider value={{ notes, tags, setNotes, setTags }}>
      {children}
    </SearchAddMetaContext.Provider>
  );
}

export function useSearchAddMeta(): SearchAddMetaContextType {
  const ctx = useContext(SearchAddMetaContext);
  if (!ctx) {
    return { notes: "", tags: [], setNotes: () => {}, setTags: () => {} };
  }
  return ctx;
}

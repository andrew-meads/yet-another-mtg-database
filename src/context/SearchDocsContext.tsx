"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

interface SearchDocsContextType {
  /** Whether the docked search-docs panel is open. */
  open: boolean;
  /** Open or close the panel. */
  setOpen: (open: boolean) => void;
  /** Toggle the panel open/closed. */
  toggle: () => void;
  /** Append an example query into the currently-active search bar. */
  insertExample: (text: string) => void;
  /**
   * Register (or clear, with `null`) the handler that receives example inserts.
   * The mounted {@link CardSearchBar} registers its appender here on mount.
   */
  registerInserter: (fn: ((text: string) => void) | null) => void;
}

const noop = () => {};

const SearchDocsContext = createContext<SearchDocsContextType | undefined>(undefined);

/**
 * Coordinates the docked search-syntax docs panel. The panel lives high in the
 * layout ({@link MainWorkspace}) so it can reflow the page, while its toggle
 * button and target input live in the deeply-nested shared `CardSearchBar`. This
 * context bridges the two: the bar toggles `open` and registers an inserter, and
 * the panel calls `insertExample` when an example chip is clicked.
 */
export function SearchDocsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const inserterRef = useRef<((text: string) => void) | null>(null);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  const registerInserter = useCallback((fn: ((text: string) => void) | null) => {
    inserterRef.current = fn;
  }, []);

  const insertExample = useCallback((text: string) => {
    inserterRef.current?.(text);
  }, []);

  const value = useMemo(
    () => ({ open, setOpen, toggle, insertExample, registerInserter }),
    [open, toggle, insertExample, registerInserter]
  );

  return <SearchDocsContext.Provider value={value}>{children}</SearchDocsContext.Provider>;
}

export function useSearchDocs(): SearchDocsContextType {
  const ctx = useContext(SearchDocsContext);
  if (!ctx) {
    return {
      open: false,
      setOpen: noop,
      toggle: noop,
      insertExample: noop,
      registerInserter: noop
    };
  }
  return ctx;
}

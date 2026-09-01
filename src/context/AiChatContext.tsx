"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useSearchDocs } from "@/context/SearchDocsContext";
import type { ChatAgentContext } from "@/lib/ai/agents/types";

interface AiChatContextType {
  /** Whether the docked AI chat panel is open. */
  open: boolean;
  /** Open or close the panel (opening closes the search-docs panel). */
  setOpen: (open: boolean) => void;
  /** Toggle the panel open/closed. */
  toggle: () => void;
  /** What the user is viewing (sent with every chat request). */
  chatContext: ChatAgentContext;
  /** Update the viewed deck/collection context (pages call this on mount). */
  setChatContext: (context: ChatAgentContext) => void;
}

const noop = () => {};

const AiChatContext = createContext<AiChatContextType | undefined>(undefined);

/**
 * Coordinates the docked AI chat panel (the deck advisor). Mirrors
 * {@link SearchDocsContext}: the panel lives high in the layout
 * ({@link MainWorkspace}) so it reflows the page, while its toggle button lives
 * on the deck page header. Only one docked panel is open at a time — opening
 * the chat closes the search docs and vice versa (simplest v1).
 *
 * Must be mounted inside {@link SearchDocsProvider}.
 */
export function AiChatProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [chatContext, setChatContext] = useState<ChatAgentContext>({});
  const { open: docsOpen, setOpen: setDocsOpen } = useSearchDocs();

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (next) setDocsOpen(false);
    },
    [setDocsOpen]
  );

  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  // The other panel opening closes this one (state adjusted during render —
  // the React-endorsed alternative to a setState-in-effect cascade).
  const [prevDocsOpen, setPrevDocsOpen] = useState(docsOpen);
  if (docsOpen !== prevDocsOpen) {
    setPrevDocsOpen(docsOpen);
    if (docsOpen) setOpenState(false);
  }

  const value = useMemo(
    () => ({ open, setOpen, toggle, chatContext, setChatContext }),
    [open, setOpen, toggle, chatContext]
  );

  return <AiChatContext.Provider value={value}>{children}</AiChatContext.Provider>;
}

export function useAiChat(): AiChatContextType {
  const ctx = useContext(AiChatContext);
  if (!ctx) {
    return { open: false, setOpen: noop, toggle: noop, chatContext: {}, setChatContext: noop };
  }
  return ctx;
}

"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSearchDocs } from "@/context/SearchDocsContext";
import SearchDocsContent from "@/components/search/SearchDocsContent";

export interface SearchDocsPanelProps {
  /** Placement / sizing classes supplied by the host layout. */
  className?: string;
}

/**
 * Docked, non-modal reference panel for the search syntax. Unlike a Sheet it is
 * a normal in-flow element, so the host ({@link MainWorkspace}) renders it as a
 * flex sibling and the rest of the UI reflows to make room. It reads
 * {@link useSearchDocs} for the close action and to route example clicks (which
 * append to the active search bar) — clicking an example never closes the panel.
 */
export default function SearchDocsPanel({ className }: SearchDocsPanelProps) {
  const { setOpen, insertExample } = useSearchDocs();

  return (
    <aside
      aria-label="Search syntax help"
      className={cn(
        "bg-background flex h-full flex-col overflow-hidden rounded-md border",
        className
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground font-semibold">Search syntax</h2>
          <p className="text-muted-foreground text-sm">
            Click any example to add it to your search. Searches are case-insensitive.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(false)}
          aria-label="Close search help"
        >
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <SearchDocsContent onInsertExample={insertExample} />
      </div>
    </aside>
  );
}

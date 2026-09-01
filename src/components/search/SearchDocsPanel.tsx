"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useSearchDocs } from "@/context/SearchDocsContext";
import SearchDocsContent from "@/components/search/SearchDocsContent";
import { REGEX_PRIMER_SECTIONS } from "@/components/search/regexPrimer";

export interface SearchDocsPanelProps {
  /** Placement / sizing classes supplied by the host layout. */
  className?: string;
}

/**
 * Docked, non-modal reference panel for search help, with two tabs: the search
 * syntax reference and a regular-expression primer. Unlike a Sheet it is a
 * normal in-flow element, so the host ({@link MainWorkspace}) renders it as a
 * flex sibling and the rest of the UI reflows to make room. It reads
 * {@link useSearchDocs} for the close action and to route example clicks (which
 * append to the active search bar) — clicking an example never closes the panel.
 */
export default function SearchDocsPanel({ className }: SearchDocsPanelProps) {
  const { setOpen, insertExample } = useSearchDocs();

  return (
    <aside
      aria-label="Search help panel"
      className={cn(
        "bg-background flex h-full flex-col overflow-hidden rounded-md border",
        className
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground font-semibold">Search help</h2>
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

      <Tabs defaultValue="syntax" className="min-h-0 flex-1 gap-0">
        <TabsList className="mx-4 mt-3 w-[calc(100%-2rem)] shrink-0">
          <TabsTrigger value="syntax">Search syntax</TabsTrigger>
          <TabsTrigger value="regex">Regular expressions</TabsTrigger>
        </TabsList>
        <TabsContent value="syntax" className="min-h-0 overflow-y-auto p-4">
          <SearchDocsContent onInsertExample={insertExample} />
        </TabsContent>
        <TabsContent value="regex" className="min-h-0 overflow-y-auto p-4">
          <SearchDocsContent sections={REGEX_PRIMER_SECTIONS} onInsertExample={insertExample} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

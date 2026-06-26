"use client";

import { Button } from "@/components/ui/button";
import { SEARCH_DOC_SECTIONS } from "@/components/search/searchDocs";

export interface SearchDocsContentProps {
  /** Called with an example query when the user clicks an example chip. */
  onInsertExample: (query: string) => void;
}

/**
 * Presentational body of the search-syntax reference: renders
 * {@link SEARCH_DOC_SECTIONS} as sections of operators, each with a clickable
 * example chip that calls `onInsertExample`. Layout/placement (panel, header,
 * scrolling) is the caller's responsibility — see {@link SearchDocsPanel}.
 */
export default function SearchDocsContent({ onInsertExample }: SearchDocsContentProps) {
  return (
    <div className="flex flex-col gap-6">
      {SEARCH_DOC_SECTIONS.map((section) => (
        <section key={section.id} className="flex flex-col gap-3">
          <h3 className="text-foreground text-sm font-semibold tracking-wide uppercase">
            {section.title}
          </h3>
          {section.intro && <p className="text-muted-foreground text-sm">{section.intro}</p>}
          <ul className="flex flex-col gap-3">
            {section.entries.map((entry, i) => (
              <li
                key={entry.syntax ? `${section.id}-${entry.syntax}-${i}` : `${section.id}-${i}`}
                className="flex flex-col gap-1.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {entry.syntax && (
                    <code className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-sm">
                      {entry.syntax}
                    </code>
                  )}
                  {entry.aliases && entry.aliases.length > 0 && (
                    <span className="text-muted-foreground font-mono text-xs">
                      {entry.aliases.join(" · ")}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground text-sm">{entry.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {entry.examples.map((example) => (
                    <Button
                      key={example}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto py-1 font-mono text-xs"
                      onClick={() => onInsertExample(example)}
                    >
                      {example}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

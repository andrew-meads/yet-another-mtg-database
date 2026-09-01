import { SEARCH_DOC_SECTIONS } from "@/components/search/searchDocs";

/**
 * Render the app's search-syntax reference (the same data the docked "Search
 * help" panel shows, `src/components/search/searchDocs.tsx`) as plain text for
 * an LLM system prompt. Deriving the cheat sheet from that single source keeps
 * the prompt in sync with the real operator set — a unit test cross-checks the
 * docs against the operators registered in `src/lib/search/config.ts`.
 */
export function buildSearchSyntaxCheatSheet(): string {
  const lines: string[] = [];

  for (const section of SEARCH_DOC_SECTIONS) {
    lines.push(`## ${section.title}`);
    if (section.intro) lines.push(section.intro);
    for (const entry of section.entries) {
      const aliases = entry.aliases?.length ? ` (aliases: ${entry.aliases.join(", ")})` : "";
      const syntax = entry.syntax ? `\`${entry.syntax}\`${aliases} — ` : "";
      const examples = entry.examples.length ? ` Examples: ${entry.examples.join(" | ")}` : "";
      lines.push(`- ${syntax}${entry.description}${examples}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

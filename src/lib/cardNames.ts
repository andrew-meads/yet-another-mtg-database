import { escapeRegex } from "@/lib/search/helpers";

/**
 * Punctuation-insensitive card-name matching. Card names can carry heavy
 * punctuation — the Unhinged card `"Ach! Hans, Run!"` literally contains
 * quotation marks, exclamation points, and a comma — and LLMs (and humans)
 * routinely drop it. Comparing normalized keys, and falling back to a relaxed
 * regex for DB lookups, makes "Ach Hans Run" find the real card. Pure and
 * client-safe (used by both the AI tool layer and the ProposalCard).
 */

/**
 * Normalization key for name comparison: lowercased, everything that isn't a
 * letter/digit collapsed to single spaces.
 */
export function normalizeCardName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Build a regex matching a card name with arbitrary punctuation around and
 * between its word tokens (e.g. "ach hans run" matches `"Ach! Hans, Run!"`).
 * Returns null for names that normalize to nothing.
 */
export function relaxedNameRegex(name: string): RegExp | null {
  const tokens = normalizeCardName(name).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  const between = "[^\\p{L}\\p{N}]+";
  const edge = "[^\\p{L}\\p{N}]*";
  return new RegExp(`^${edge}${tokens.map(escapeRegex).join(between)}${edge}$`, "iu");
}

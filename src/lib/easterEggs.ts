/**
 * Easter-egg triggers. Pure helpers so they can be unit-tested and shared by
 * every empty state that participates.
 */

/** The mascot's full name. Searching for it (there is no such card) reveals the mascot. */
export const NOUGHTY_NAME = "Noughty the Dreadnought";

/**
 * Accepted spellings of a "Noughty the Dreadnought" search, matched against the
 * whitespace-collapsed, case-folded query:
 *   noughty the dreadnought            (plain text search)
 *   "noughty the dreadnought"          (quoted text search, either quote style)
 *   name:noughty the dreadnought       (name search)
 *   name:"noughty the dreadnought"     (quoted name search — what Advanced Search emits)
 * An optional leading `!` (Scryfall's exact-name prefix) is tolerated.
 */
const NOUGHTY_QUERY = /^!?(?:name:)?(["']?)noughty the dreadnought\1$/i;

/**
 * True when the user's search text is exactly a search for the mascot by name,
 * i.e. the query (or its `name:` operator) is "noughty the dreadnought" and
 * nothing else. Case-insensitive; surrounding/repeated whitespace is ignored.
 */
export function isNoughtyQuery(query: string | null | undefined): boolean {
  if (!query) return false;
  return NOUGHTY_QUERY.test(query.trim().replace(/\s+/g, " "));
}

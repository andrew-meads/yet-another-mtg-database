/**
 * Extract a set-code -> released_at map from Scryfall set objects (as returned
 * by `GET /sets`), skipping malformed entries. Pure helper used by the
 * backfill-release-dates script.
 */
export function extractSetDates(sets: unknown[]): Map<string, string> {
  const dates = new Map<string, string>();
  for (const entry of sets) {
    if (typeof entry !== "object" || entry === null) continue;
    const { code, released_at } = entry as { code?: unknown; released_at?: unknown };
    if (typeof code !== "string" || code === "") continue;
    if (typeof released_at !== "string" || released_at === "") continue;
    dates.set(code.toLowerCase(), released_at);
  }
  return dates;
}

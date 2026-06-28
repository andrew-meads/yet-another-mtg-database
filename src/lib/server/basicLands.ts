import { CardData } from "@/db/schema";
import { MtgCard } from "@/types/MtgCard";

/** The five basic land names, in WUBRG order. */
export const BASIC_LAND_NAMES = ["Plains", "Island", "Swamp", "Mountain", "Forest"] as const;

/** Set code whose basic-land printings are used for ephemeral lands (for now). */
export const BASIC_LAND_SET = "unh";

let cached: MtgCard[] | null = null;

/**
 * Resolves the five basic lands (one printing each, from {@link BASIC_LAND_SET}),
 * in WUBRG order. When a set has multiple art variants of a land, the printing
 * with the lowest collector number is chosen deterministically. The result is
 * memoized in-process since the reference data never changes.
 */
export async function getBasicLands(): Promise<MtgCard[]> {
  if (cached) return cached;

  const docs = await CardData.find({
    set: BASIC_LAND_SET,
    name: { $in: BASIC_LAND_NAMES as unknown as string[] }
  }).lean();

  const byName = new Map<string, MtgCard>();
  for (const doc of docs as unknown as MtgCard[]) {
    const existing = byName.get(doc.name);
    if (!existing || collectorNumberLt(doc.collector_number, existing.collector_number)) {
      byName.set(doc.name, doc);
    }
  }

  const lands = BASIC_LAND_NAMES.map((name) => byName.get(name)).filter(
    (c): c is MtgCard => Boolean(c)
  );

  // Only memoize once all five are present, so a partially-seeded DB can recover.
  if (lands.length === BASIC_LAND_NAMES.length) cached = lands;
  return lands;
}

/** Test-only: clear the in-process memo so a reset DB resolves freshly. */
export function resetBasicLandsCache() {
  cached = null;
}

/** Numeric-aware comparison of Scryfall collector numbers (which may be strings). */
function collectorNumberLt(a?: string, b?: string): boolean {
  const na = Number.parseInt(a ?? "", 10);
  const nb = Number.parseInt(b ?? "", 10);
  if (Number.isNaN(na) || Number.isNaN(nb)) return String(a) < String(b);
  return na < nb;
}

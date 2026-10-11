import { COLOR_COMBINATION_ORDER } from "@/lib/sortConfig";

/**
 * One-shot "sort this section into columns" logic for the deck editor. Pure and
 * client-safe; the server helper (`src/lib/server/deckSectionSort.ts`) feeds it the
 * section's cards and writes the resulting column arrays back to the deck.
 */

export const SECTION_SORT_MODES = [
  "manaValue",
  "manaValueThenColor",
  "manaValueThenName",
  "color",
  "colorThenManaValue",
  "colorThenName"
] as const;

export type SectionSortMode = (typeof SECTION_SORT_MODES)[number];

export const SECTION_SORT_MODE_LABELS: Record<SectionSortMode, string> = {
  manaValue: "Mana value",
  manaValueThenColor: "Mana value, then color",
  manaValueThenName: "Mana value, then alphabetically",
  color: "Color",
  colorThenManaValue: "Color, then mana value",
  colorThenName: "Color, then alphabetically"
};

/** The card fields the sort needs. `id` is the PhysicalCard id. */
export interface SortableCard {
  id: string;
  name: string;
  cmc: number;
  typeLine: string;
  /** Effective colors: top-level `colors` united with every face's `colors`. */
  colors: string[];
}

/** Mana values at or above this share one column. */
export const MAX_MANA_VALUE_BUCKET = 7;

const WUBRG = ["W", "U", "B", "R", "G"];

export type ColorGroup = "W" | "U" | "B" | "R" | "G" | "multicolor" | "colorless";

/** Column order for color mode (lands follow in their own column). */
export const COLOR_GROUP_ORDER: ColorGroup[] = ["W", "U", "B", "R", "G", "multicolor", "colorless"];

/**
 * Whether a card goes in the Lands column. Only the front face counts, so an MDFC with
 * a spell on the front and a land on the back sorts as a spell.
 */
export function isLandForSort(typeLine: string): boolean {
  return /\bLand\b/.test(typeLine.split(" // ")[0]);
}

/** Mana value column for a card: floored (for half-mana un-cards) and capped at 7+. */
export function manaValueBucket(cmc: number): number {
  return Math.min(Math.max(0, Math.floor(cmc || 0)), MAX_MANA_VALUE_BUCKET);
}

function normalizeColors(colors: string[]): string[] {
  return WUBRG.filter((c) => colors.includes(c));
}

export function colorGroup(colors: string[]): ColorGroup {
  const normalized = normalizeColors(colors);
  if (normalized.length === 0) return "colorless";
  if (normalized.length > 1) return "multicolor";
  return normalized[0] as ColorGroup;
}

/** Position of the card's color combination in WUBRG combination order; colorless last. */
export function colorComboIndex(colors: string[]): number {
  const key = normalizeColors(colors).join("");
  const index = COLOR_COMBINATION_ORDER.findIndex((combo) => combo.join("") === key);
  return index === -1 ? COLOR_COMBINATION_ORDER.length : index;
}

type Comparator = (a: SortableCard, b: SortableCard) => number;

const byName: Comparator = (a, b) => a.name.localeCompare(b.name);
const byColor: Comparator = (a, b) => colorComboIndex(a.colors) - colorComboIndex(b.colors);
const byManaValue: Comparator = (a, b) => (a.cmc || 0) - (b.cmc || 0);

function chain(...comparators: Comparator[]): Comparator {
  return (a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

function secondaryComparator(mode: SectionSortMode): Comparator | null {
  switch (mode) {
    case "manaValueThenColor":
      return chain(byColor, byName);
    case "colorThenManaValue":
      // Inside Multicolor, keep each color combination together before ordering by MV.
      return chain(byColor, byManaValue, byName);
    case "manaValueThenName":
    case "colorThenName":
      return byName;
    default:
      return null;
  }
}

function primaryBuckets(spells: SortableCard[], mode: SectionSortMode): SortableCard[][] {
  if (mode.startsWith("manaValue")) {
    if (spells.length === 0) return [];
    const buckets = spells.map((c) => manaValueBucket(c.cmc));
    const start = buckets.includes(0) ? 0 : 1;
    const end = Math.max(...buckets);
    const columns: SortableCard[][] = Array.from({ length: end - start + 1 }, () => []);
    spells.forEach((card, i) => columns[buckets[i] - start].push(card));
    return columns;
  }

  const groups = new Map<ColorGroup, SortableCard[]>();
  for (const card of spells) {
    const group = colorGroup(card.colors);
    groups.set(group, [...(groups.get(group) ?? []), card]);
  }
  return COLOR_GROUP_ORDER.filter((g) => groups.has(g)).map((g) => groups.get(g)!);
}

/**
 * Splits a section's cards into columns for the given mode, returning the PhysicalCard
 * ids of each column in order.
 *
 * - Mana value: one column per MV from 1 (or 0 when any non-land has MV 0) up to the
 *   highest present, with 7+ shared. MVs in that range with no cards get empty columns.
 * - Color: W, U, B, R, G, Multicolor, Colorless, only those that have cards.
 * - Lands always go in a final column of their own.
 *
 * `cards` must be in the section's current reading order (column by column, top to
 * bottom). Without a secondary key that order is kept inside each column; with one,
 * columns are sorted by the secondary key and then by name.
 */
export function arrangeSectionColumns(cards: SortableCard[], mode: SectionSortMode): string[][] {
  const spells = cards.filter((c) => !isLandForSort(c.typeLine));
  const lands = cards.filter((c) => isLandForSort(c.typeLine));

  const columns = primaryBuckets(spells, mode);
  if (lands.length > 0) columns.push(lands);

  const compare = secondaryComparator(mode);
  return columns.map((column) =>
    (compare ? [...column].sort(compare) : column).map((card) => card.id)
  );
}

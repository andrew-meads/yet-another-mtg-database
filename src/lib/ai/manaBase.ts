/**
 * Deterministic mana-base analysis for the deck advisor. The LLM interprets
 * these numbers; it never counts cards itself (models miscount). Pure functions
 * over card data — no DB, no network — so the whole module is unit-testable.
 */

export const MANA_COLORS = ["W", "U", "B", "R", "G", "C"] as const;
export type ManaColor = (typeof MANA_COLORS)[number];

/** The card fields the analyzer reads (a structural subset of MtgCard/LlmCard). */
export interface ManaBaseCard {
  name: string;
  type_line: string;
  cmc: number;
  mana_cost?: string;
  oracle_text?: string;
  produced_mana?: string[];
  card_faces?: Array<{
    mana_cost?: string;
    oracle_text?: string;
  }>;
}

export interface ManaBaseStats {
  totalCards: number;
  landCount: number;
  nonlandCount: number;
  /** Cards (any type) that can produce each color of mana. */
  sources: Record<ManaColor, number>;
  /** Subset of `sources` that are lands. */
  landSources: Record<ManaColor, number>;
  /** Colored pips in the mana costs of nonland cards (hybrids count for each half). */
  pips: Record<ManaColor, number>;
  /** Nonland cards by mana value: keys "0".."6" and "7+". */
  curve: Record<string, number>;
  /** Mean mana value of nonland cards (0 when there are none). */
  averageManaValue: number;
  /** Per-color comparison of mana sources to demand, sorted by pip count. */
  sourcesVsPips: Array<{ color: ManaColor; sources: number; pips: number }>;
}

function emptyColorRecord(): Record<ManaColor, number> {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

/**
 * A card counts as a land when any part of its type line says Land — this
 * includes artifact lands and modal double-faced spell//land cards (which can
 * always be played as the land face).
 */
export function isLand(card: Pick<ManaBaseCard, "type_line">): boolean {
  return /\bLand\b/i.test(card.type_line);
}

/**
 * The colors of mana a card can produce. Prefers Scryfall's `produced_mana`
 * (top-level even on MDFC lands); falls back to scanning oracle text for
 * "Add ..." clauses ({G} symbols, or "any color" meaning all five).
 */
export function producedColors(card: ManaBaseCard): ManaColor[] {
  if (card.produced_mana && card.produced_mana.length > 0) {
    return MANA_COLORS.filter((c) => card.produced_mana!.includes(c));
  }

  const texts = [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter(
    (t): t is string => Boolean(t)
  );
  const found = new Set<ManaColor>();
  for (const text of texts) {
    // Each "Add ..." clause up to the end of its sentence/line.
    for (const clause of text.match(/\badd\b[^.\n]*/gi) ?? []) {
      for (const [, symbol] of clause.matchAll(/\{([WUBRGC])\}/gi)) {
        found.add(symbol.toUpperCase() as ManaColor);
      }
      if (/any color|any one color/i.test(clause)) {
        for (const c of ["W", "U", "B", "R", "G"] as const) found.add(c);
      }
    }
  }
  return MANA_COLORS.filter((c) => found.has(c));
}

/**
 * Count colored pips in a mana cost string. Hybrid symbols count toward every
 * color they name ({W/U} adds one W pip and one U pip; {2/W} and phyrexian
 * {G/P} count their color; {C} counts as a colorless-specific pip). Generic
 * costs contribute nothing.
 */
export function countPips(manaCost: string): Record<ManaColor, number> {
  const pips = emptyColorRecord();
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    for (const part of symbol.toUpperCase().split("/")) {
      if ((MANA_COLORS as readonly string[]).includes(part)) {
        pips[part as ManaColor] += 1;
      }
    }
  }
  return pips;
}

/** The mana cost(s) a card presents: root cost, or its faces' costs joined. */
function effectiveManaCost(card: ManaBaseCard): string {
  if (card.mana_cost) return card.mana_cost;
  return (card.card_faces ?? [])
    .map((f) => f.mana_cost ?? "")
    .filter(Boolean)
    .join("");
}

/**
 * Analyze a decklist (one element per physical copy). Returns land/nonland
 * counts, mana sources by color (all cards and lands only), colored-pip demand
 * across nonland mana costs, the mana curve, and a sources-vs-pips table.
 */
export function analyzeManaBase(cards: ManaBaseCard[]): ManaBaseStats {
  const sources = emptyColorRecord();
  const landSources = emptyColorRecord();
  const pips = emptyColorRecord();
  const curve: Record<string, number> = {
    "0": 0,
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
    "6": 0,
    "7+": 0
  };

  let landCount = 0;
  let nonlandCount = 0;
  let totalManaValue = 0;

  for (const card of cards) {
    const land = isLand(card);
    const produced = producedColors(card);
    for (const color of produced) {
      sources[color] += 1;
      if (land) landSources[color] += 1;
    }

    if (land) {
      landCount += 1;
      continue;
    }

    nonlandCount += 1;
    const mv = Number.isFinite(card.cmc) ? card.cmc : 0;
    totalManaValue += mv;
    const bucket = mv >= 7 ? "7+" : String(Math.max(0, Math.floor(mv)));
    curve[bucket] += 1;

    const cardPips = countPips(effectiveManaCost(card));
    for (const color of MANA_COLORS) pips[color] += cardPips[color];
  }

  const sourcesVsPips = MANA_COLORS.filter((c) => pips[c] > 0 || sources[c] > 0)
    .map((color) => ({ color, sources: sources[color], pips: pips[color] }))
    .sort((a, b) => b.pips - a.pips);

  return {
    totalCards: cards.length,
    landCount,
    nonlandCount,
    sources,
    landSources,
    pips,
    curve,
    averageManaValue: nonlandCount > 0 ? Math.round((totalManaValue / nonlandCount) * 100) / 100 : 0,
    sourcesVsPips
  };
}

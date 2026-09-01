import { SearchOperatorConfig } from "../types";

/**
 * Mana-symbol letters accepted by produces:. Unlike card colors, produced mana
 * includes "C" for actual colorless mana (e.g. Sol Ring produces {C}{C}).
 */
const PRODUCED_MANA_MAP: Record<string, string> = {
  w: "W",
  u: "U",
  b: "B",
  r: "R",
  g: "G",
  c: "C",
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  colorless: "C"
};

function parseProducedMana(value: string): string[] {
  const lower = value.toLowerCase();
  if (PRODUCED_MANA_MAP[lower]) return [PRODUCED_MANA_MAP[lower]];

  const symbols: string[] = [];
  for (const char of lower) {
    if (PRODUCED_MANA_MAP[char]) symbols.push(PRODUCED_MANA_MAP[char]);
  }
  return [...new Set(symbols)];
}

/**
 * Produced mana: produces:g, produces:wu, produces:c (colorless mana).
 * Matches Scryfall's `produced_mana` field — every kind of mana any of the
 * card's abilities can add. "Has at least these" semantics for all operators.
 */
export const producesOperator: SearchOperatorConfig = {
  aliases: ["produces"],
  buildQuery: (value) => {
    const symbols = parseProducedMana(value);
    if (symbols.length === 0) return null;
    return { produced_mana: { $all: symbols } };
  }
};

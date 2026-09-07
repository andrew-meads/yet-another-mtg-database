/**
 * Per-copy physical attributes of a card: its finish (foiling) and condition
 * (wear grade). Pure and client-safe — shared by the Mongoose schema, the API
 * validation, the grouping logic, and the pickers/badges in the UI.
 *
 * Both attributes are OPTIONAL on a physical card document. An absent value is
 * exactly equivalent to the default (`nonfoil` / `NM`), so a database created
 * before these fields existed needs no backfill: always read them through
 * `effectiveFinish` / `effectiveCondition`.
 */

/**
 * Finishes mirror Scryfall's `finishes` vocabulary, which is also what its
 * price fields key on (`usd` / `usd_foil` / `usd_etched`).
 */
export const CARD_FINISHES = ["nonfoil", "foil", "etched"] as const;
export type CardFinish = (typeof CARD_FINISHES)[number];
export const DEFAULT_FINISH: CardFinish = "nonfoil";

export const FINISH_LABELS: Record<CardFinish, string> = {
  nonfoil: "Non-foil",
  foil: "Foil",
  etched: "Etched foil"
};

/**
 * Conditions use the five-grade TCGplayer scale that price guides and trade
 * listings quote against. Ordered best → worst.
 */
export const CARD_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type CardCondition = (typeof CARD_CONDITIONS)[number];
export const DEFAULT_CONDITION: CardCondition = "NM";

export const CONDITION_LABELS: Record<CardCondition, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged"
};

export function isCardFinish(value: unknown): value is CardFinish {
  return typeof value === "string" && (CARD_FINISHES as readonly string[]).includes(value);
}

export function isCardCondition(value: unknown): value is CardCondition {
  return typeof value === "string" && (CARD_CONDITIONS as readonly string[]).includes(value);
}

/** The finish a copy effectively has: its stored value, or the default when unset. */
export function effectiveFinish(finish: CardFinish | null | undefined): CardFinish {
  return finish ?? DEFAULT_FINISH;
}

/** The condition a copy effectively has: its stored value, or the default when unset. */
export function effectiveCondition(condition: CardCondition | null | undefined): CardCondition {
  return condition ?? DEFAULT_CONDITION;
}

/**
 * Rank used for ordering copies of the same printing: default finish first,
 * then the rarer finishes; conditions best → worst.
 */
export function finishRank(finish: CardFinish | null | undefined): number {
  return CARD_FINISHES.indexOf(effectiveFinish(finish));
}

export function conditionRank(condition: CardCondition | null | undefined): number {
  return CARD_CONDITIONS.indexOf(effectiveCondition(condition));
}

/**
 * A stable key fragment identifying a (finish, condition) pair, with unset
 * values normalized to the defaults — so copies stored with and without
 * explicit defaults group together.
 */
export function attributesKey(
  finish: CardFinish | null | undefined,
  condition: CardCondition | null | undefined
): string {
  return `${effectiveFinish(finish)}|${effectiveCondition(condition)}`;
}

/**
 * Whether two copies carry the same effective finish and condition (unset
 * values compare equal to the defaults). Used when matching a display group
 * back to its physical copies.
 */
export function attributesMatch(
  a: { finish?: CardFinish | null; condition?: CardCondition | null },
  b: { finish?: CardFinish | null; condition?: CardCondition | null }
): boolean {
  return (
    effectiveFinish(a.finish) === effectiveFinish(b.finish) &&
    effectiveCondition(a.condition) === effectiveCondition(b.condition)
  );
}

/**
 * The subset of `{ finish, condition }` worth persisting: default values are
 * dropped (absent means default), so writing a plain copy stores nothing extra.
 */
export function sparseAttributes(
  finish: CardFinish | null | undefined,
  condition: CardCondition | null | undefined
): { finish?: CardFinish; condition?: CardCondition } {
  const out: { finish?: CardFinish; condition?: CardCondition } = {};
  if (finish && finish !== DEFAULT_FINISH) out.finish = finish;
  if (condition && condition !== DEFAULT_CONDITION) out.condition = condition;
  return out;
}

/**
 * Short human-readable summary of the non-default attributes of a copy, e.g.
 * "Foil", "LP", "Foil · LP" — or null when both are at their defaults (so
 * badges can be hidden for ordinary copies).
 */
export function describeAttributes(
  finish: CardFinish | null | undefined,
  condition: CardCondition | null | undefined
): string | null {
  const parts: string[] = [];
  const f = effectiveFinish(finish);
  const c = effectiveCondition(condition);
  if (f !== DEFAULT_FINISH) parts.push(FINISH_LABELS[f]);
  if (c !== DEFAULT_CONDITION) parts.push(c);
  return parts.length > 0 ? parts.join(" · ") : null;
}

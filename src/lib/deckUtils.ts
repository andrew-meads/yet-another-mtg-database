import { DECK_SECTION_KINDS, DeckSection, DeckSectionKind, DeckWithCards } from "@/types/Deck";

/** Narrow an unknown value (e.g. a request body field) to a section kind. */
export function isDeckSectionKind(value: unknown): value is DeckSectionKind {
  return typeof value === "string" && (DECK_SECTION_KINDS as readonly string[]).includes(value);
}

/** A section's kind, with an absent (or unknown) stored value read as "normal". */
export function effectiveSectionKind(kind: string | null | undefined): DeckSectionKind {
  return isDeckSectionKind(kind) ? kind : "normal";
}

/** UI / export labels for each section kind. */
export const DECK_SECTION_KIND_LABELS: Record<DeckSectionKind, string> = {
  normal: "Normal",
  sideboard: "Sideboard",
  scratch: "Scratch area"
};

/**
 * Stable-sorts sections into export order: normal sections first, then
 * sideboard sections, then scratch areas, keeping deck order within each kind.
 */
export function sortSectionsByKind<T extends { kind?: string | null }>(sections: T[]): T[] {
  const rank = (s: T) => DECK_SECTION_KINDS.indexOf(effectiveSectionKind(s.kind));
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => rank(a.section) - rank(b.section) || a.index - b.index)
    .map(({ section }) => section);
}

/** Total number of physical cards across every column of a section. */
export function countSectionCards(section: DeckSection): number {
  return section.columns.reduce((total, column) => total + column.cards.length, 0);
}

/** Card totals of a deck split by section kind. */
export type DeckCardCounts = Record<DeckSectionKind, number>;

/** Card totals per section kind: main deck ("normal"), sideboard, and scratch areas. */
export function countDeckCardsByKind(deck: DeckWithCards): DeckCardCounts {
  const counts: DeckCardCounts = { normal: 0, sideboard: 0, scratch: 0 };
  for (const section of deck.sections) {
    counts[effectiveSectionKind(section.kind)] += countSectionCards(section);
  }
  return counts;
}

/**
 * Number of cards in the main deck: every normal section. Sideboard and
 * scratch-area cards don't count toward it.
 */
export function countDeckCards(deck: DeckWithCards): number {
  return countDeckCardsByKind(deck).normal;
}

/** "1 card" / "N cards". */
export function formatCardCount(count: number): string {
  return `${count} ${count === 1 ? "card" : "cards"}`;
}

/** "60 cards" or, with a sideboard, "60 cards + 15 sideboard". */
export function formatDeckCardCount(main: number, sideboard: number): string {
  return sideboard > 0
    ? `${formatCardCount(main)} + ${sideboard} sideboard`
    : formatCardCount(main);
}

/** Where a dragged section lands relative to the section it is dropped on. */
export type SectionDropPosition = "before" | "after";

/**
 * The section id order after dropping `draggedId` before or after `targetId`.
 * Returns null when the drop would leave the order unchanged (dropping a section on
 * itself or into the gap it already occupies) or either id is unknown.
 */
export function moveSectionInOrder(
  order: string[],
  draggedId: string,
  targetId: string,
  position: SectionDropPosition
): string[] | null {
  if (!order.includes(draggedId) || !order.includes(targetId) || draggedId === targetId) {
    return null;
  }
  const rest = order.filter((id) => id !== draggedId);
  const targetIndex = rest.indexOf(targetId);
  const next = [...rest];
  next.splice(position === "before" ? targetIndex : targetIndex + 1, 0, draggedId);
  return next.every((id, i) => id === order[i]) ? null : next;
}

/** True when `order` lists every id in `ids` exactly once and nothing else. */
export function isSectionOrderFor(order: unknown, ids: string[]): order is string[] {
  if (!Array.isArray(order) || order.length !== ids.length) return false;
  const seen = new Set(order);
  return seen.size === ids.length && ids.every((id) => seen.has(id));
}

/** `sections` rearranged to follow `order` (by `_id`); ids missing from it keep their place at the end. */
export function applySectionOrder<T extends { _id: string }>(sections: T[], order: string[]): T[] {
  const rank = (s: T) => {
    const index = order.indexOf(s._id);
    return index === -1 ? order.length : index;
  };
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => rank(a.section) - rank(b.section) || a.index - b.index)
    .map(({ section }) => section);
}

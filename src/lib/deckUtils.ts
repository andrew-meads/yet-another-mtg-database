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

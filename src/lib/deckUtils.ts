import { DeckSection, DeckWithCards } from "@/types/Deck";

/** Total number of physical cards across every column of a section. */
export function countSectionCards(section: DeckSection): number {
  return section.columns.reduce((total, column) => total + column.cards.length, 0);
}

/** Total number of physical cards across every section of a deck. */
export function countDeckCards(deck: DeckWithCards): number {
  return deck.sections.reduce((total, section) => total + countSectionCards(section), 0);
}

/** "1 card" / "N cards". */
export function formatCardCount(count: number): string {
  return `${count} ${count === 1 ? "card" : "cards"}`;
}

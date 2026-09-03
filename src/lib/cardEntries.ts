import { CardDataMap, DetailedPhysicalCard, DetailedPhysicalCardEntry } from "@/types/PhysicalCard";
import { DeckWithCardEntries, DeckWithCards } from "@/types/Deck";

/**
 * Re-joins wire entries with the response's deduplicated card-data map back into
 * the DetailedPhysicalCard shape the components consume. Duplicate copies share
 * the same card object reference (the dedup survives into the JS heap). Entries
 * whose card is missing from the map are dropped.
 */
export function joinCardEntries(
  entries: DetailedPhysicalCardEntry[],
  cardData: CardDataMap
): DetailedPhysicalCard[] {
  return entries.flatMap((entry) => {
    const card = cardData[entry.cardId];
    if (!card) return [];
    const { cardId: _cardId, ...rest } = entry;
    return [{ ...rest, card }];
  });
}

/**
 * Joins a wire-form deck (entries by cardId) with its card-data map into the
 * DeckWithCards shape: every column's entries become DetailedPhysicalCards.
 */
export function joinDeckEntries(deck: DeckWithCardEntries, cardData: CardDataMap): DeckWithCards {
  return {
    ...deck,
    sections: deck.sections.map((section) => ({
      ...section,
      columns: section.columns.map((column) => ({
        ...column,
        cards: joinCardEntries(column.cards, cardData)
      }))
    }))
  };
}

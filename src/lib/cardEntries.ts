import { CardDataMap, DetailedPhysicalCard, DetailedPhysicalCardEntry } from "@/types/PhysicalCard";

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

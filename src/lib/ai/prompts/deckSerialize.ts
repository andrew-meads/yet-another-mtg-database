/**
 * Compact text serialization of decks/collections for LLM tool results. One
 * line per distinct printing ("4x Forest [neo]") keeps a 100-card deck around
 * a few hundred tokens instead of shipping card objects per copy.
 */

/** The card fields the serializer needs (any card map value satisfies this). */
export interface SerializableCard {
  name: string;
  set: string;
  type_line?: string;
  mana_cost?: string;
}

export interface SerializableSection {
  name: string;
  /** One element per physical copy, in deck order. */
  cardIds: string[];
  /** Card ids (same list) that are ephemeral placeholders, if any. */
  ephemeralIds?: Set<string>;
}

/** Count copies per cardId, preserving first-seen order. */
export function groupCounts(cardIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

function cardLine(count: number, card: SerializableCard | undefined, cardId: string): string {
  if (!card) return `${count}x <unknown card ${cardId}>`;
  const cost = card.mana_cost ? ` ${card.mana_cost}` : "";
  const type = card.type_line ? ` — ${card.type_line}` : "";
  return `${count}x ${card.name} [${card.set}]${cost}${type}`;
}

/**
 * Serialize a deck section-by-section:
 *
 * ```
 * ## Lands (24 cards)
 * 4x Forest [neo]
 * ```
 */
export function serializeDeck(
  deckName: string,
  sections: SerializableSection[],
  cardData: Record<string, SerializableCard>
): string {
  const lines: string[] = [];
  let total = 0;

  for (const section of sections) {
    total += section.cardIds.length;
    lines.push(`## ${section.name} (${section.cardIds.length} cards)`);
    if (section.cardIds.length === 0) {
      lines.push("(empty)");
      continue;
    }
    for (const [cardId, count] of groupCounts(section.cardIds)) {
      lines.push(cardLine(count, cardData[cardId], cardId));
    }
  }

  return [`Deck: ${deckName} (${total} cards)`, ...lines].join("\n");
}

/**
 * Serialize a flat list of copies (a collection slice) as counted lines. The
 * caller is responsible for capping the number of distinct cards beforehand.
 */
export function serializeCardList(
  cardIds: string[],
  cardData: Record<string, SerializableCard>
): string {
  const lines: string[] = [];
  for (const [cardId, count] of groupCounts(cardIds)) {
    lines.push(cardLine(count, cardData[cardId], cardId));
  }
  return lines.join("\n");
}

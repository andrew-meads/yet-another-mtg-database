/**
 * Compact text serialization of decks/collections for LLM tool results. One
 * line per distinct printing ("4x Forest [neo]") keeps a 100-card deck around
 * a few hundred tokens instead of shipping card objects per copy.
 */

import { DeckSectionKind } from "@/types/Deck";

/** The card fields the serializer needs (any card map value satisfies this). */
export interface SerializableCard {
  name: string;
  set: string;
  type_line?: string;
  mana_cost?: string;
}

export interface SerializableSection {
  name: string;
  /** Absent means a normal (main-deck) section. */
  kind?: DeckSectionKind;
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

/** Header suffix marking a section whose cards don't count toward the main deck. */
const KIND_NOTES: Record<DeckSectionKind, string> = {
  normal: "",
  sideboard: " [SIDEBOARD — not in the main deck]",
  scratch: " [SCRATCH AREA — not part of the deck; ideas/candidates only]"
};

/**
 * Serialize a deck section-by-section:
 *
 * ```
 * ## Lands (24 cards)
 * 4x Forest [neo]
 * ```
 *
 * Sideboard and scratch-area sections are flagged in their header and excluded
 * from the headline main-deck total (listed beside it instead).
 */
export function serializeDeck(
  deckName: string,
  sections: SerializableSection[],
  cardData: Record<string, SerializableCard>
): string {
  const lines: string[] = [];
  const totals: Record<DeckSectionKind, number> = { normal: 0, sideboard: 0, scratch: 0 };

  for (const section of sections) {
    const kind = section.kind ?? "normal";
    totals[kind] += section.cardIds.length;
    lines.push(`## ${section.name} (${section.cardIds.length} cards)${KIND_NOTES[kind]}`);
    if (section.cardIds.length === 0) {
      lines.push("(empty)");
      continue;
    }
    for (const [cardId, count] of groupCounts(section.cardIds)) {
      lines.push(cardLine(count, cardData[cardId], cardId));
    }
  }

  let headline = `Deck: ${deckName} (${totals.normal} cards`;
  if (totals.sideboard > 0) headline += `, +${totals.sideboard} sideboard`;
  if (totals.scratch > 0) headline += `, +${totals.scratch} in scratch areas`;
  return [`${headline})`, ...lines].join("\n");
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

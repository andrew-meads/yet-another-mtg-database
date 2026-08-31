import { SlimMtgCard } from "@/types/MtgCard";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { DeckWithCards } from "@/types/Deck";

/** A real collection card that can stand in for one of a group's ephemeral slots. */
export interface FillCandidate {
  physicalCard: DetailedPhysicalCard;
  /** True when this candidate is the exact printing of one of the group's slots. */
  samePrinting: boolean;
}

/**
 * All of a deck's ephemeral copies of one card (any printing), plus the real
 * cards in a collection that could replace them.
 */
export interface FillGroup {
  /** Card identity: oracle_id, falling back to the lowercased name. */
  key: string;
  /** Representative card data (the first ephemeral's printing). */
  card: SlimMtgCard;
  /** The deck slots to fill, in deck order. */
  ephemerals: { id: string; scryfallId: string }[];
  /** Matching collection cards, same-printing candidates first. */
  candidates: FillCandidate[];
}

function cardKey(card: SlimMtgCard): string {
  return card.oracle_id ?? card.name.toLowerCase();
}

/**
 * Matches a deck's ephemeral cards against a collection's real cards, grouped
 * by card identity (oracle_id, name fallback — so any printing matches).
 *
 * Candidates exclude ephemeral collection entries, copies already placed in
 * this deck, and — unless `includeDeckAssigned` — copies assigned to any other
 * deck. Within a group, exact-printing candidates sort first.
 */
export function buildFillGroups(
  deck: DeckWithCards,
  collectionCards: DetailedPhysicalCard[],
  opts?: { includeDeckAssigned?: boolean }
): FillGroup[] {
  const includeDeckAssigned = opts?.includeDeckAssigned ?? false;
  const groups = new Map<string, FillGroup>();

  for (const section of deck.sections) {
    for (const column of section.columns) {
      for (const pc of column.cards) {
        if (!pc.isEphemeral) continue;
        const key = cardKey(pc.card);
        let group = groups.get(key);
        if (!group) {
          group = { key, card: pc.card, ephemerals: [], candidates: [] };
          groups.set(key, group);
        }
        group.ephemerals.push({ id: pc._id, scryfallId: pc.card.id });
      }
    }
  }
  if (groups.size === 0) return [];

  for (const pc of collectionCards) {
    if (pc.isEphemeral) continue;
    if (pc.deckId === deck._id) continue;
    if (!includeDeckAssigned && pc.deckId) continue;
    const group = groups.get(cardKey(pc.card));
    if (!group) continue;
    group.candidates.push({
      physicalCard: pc,
      samePrinting: group.ephemerals.some((e) => e.scryfallId === pc.card.id)
    });
  }

  const result = [...groups.values()];
  for (const group of result) {
    group.candidates.sort((a, b) => {
      if (a.samePrinting !== b.samePrinting) return a.samePrinting ? -1 : 1;
      const setCmp = a.physicalCard.card.set.localeCompare(b.physicalCard.card.set);
      if (setCmp !== 0) return setCmp;
      return a.physicalCard.card.collector_number.localeCompare(
        b.physicalCard.card.collector_number,
        undefined,
        { numeric: true }
      );
    });
  }
  result.sort((a, b) => a.card.name.localeCompare(b.card.name));
  return result;
}

/**
 * Pairs a group's selected candidates with its ephemeral slots: exact-printing
 * selections take an identical-printing slot first, remaining selections take
 * the remaining slots in deck order. Selections beyond the number of slots are
 * ignored.
 */
export function assignSwaps(
  group: FillGroup,
  selectedPhysicalCardIds: string[]
): { ephemeralId: string; physicalCardId: string }[] {
  const selected = selectedPhysicalCardIds
    .map((id) => group.candidates.find((c) => c.physicalCard._id === id))
    .filter((c): c is FillCandidate => Boolean(c));

  const slots = [...group.ephemerals];
  const swaps: { ephemeralId: string; physicalCardId: string }[] = [];
  const deferred: FillCandidate[] = [];

  for (const candidate of selected) {
    const slotIndex = candidate.samePrinting
      ? slots.findIndex((s) => s.scryfallId === candidate.physicalCard.card.id)
      : -1;
    if (slotIndex === -1) {
      deferred.push(candidate);
      continue;
    }
    swaps.push({
      ephemeralId: slots[slotIndex].id,
      physicalCardId: candidate.physicalCard._id
    });
    slots.splice(slotIndex, 1);
  }
  for (const candidate of deferred) {
    const slot = slots.shift();
    if (!slot) break;
    swaps.push({ ephemeralId: slot.id, physicalCardId: candidate.physicalCard._id });
  }
  return swaps;
}

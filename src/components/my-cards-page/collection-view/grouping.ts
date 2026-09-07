import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { SlimMtgCard } from "@/types/MtgCard";
import {
  CardCondition,
  CardFinish,
  attributesKey,
  conditionRank,
  effectiveCondition,
  effectiveFinish,
  finishRank
} from "@/lib/cardAttributes";

/**
 * One collection-table display row: copies grouped by card + notes + tags +
 * finish + condition + deck. Finish/condition are the EFFECTIVE values (unset
 * copies group with explicit non-foil / NM ones).
 */
export interface CollectionGroupRow {
  key: string;
  card: SlimMtgCard;
  notes?: string;
  tags?: string[];
  finish: CardFinish;
  condition: CardCondition;
  /** Single deck membership for this row (null = loose copies). */
  deckId: string | null;
  deckName?: string;
  physicalCardIds: string[];
  quantity: number;
}

/** Shared CSS grid template for the collection table header + rows. */
export const COLLECTION_GRID =
  "2.25rem minmax(160px,1.6fr) 7rem minmax(120px,1fr) 3.5rem 3rem 3.5rem 7rem 10rem";

export function groupCollectionCards(cards: DetailedPhysicalCard[]): CollectionGroupRow[] {
  const map = new Map<string, CollectionGroupRow>();
  for (const c of cards) {
    const tagsKey = (c.tags ?? []).slice().sort().join(",");
    const deckId = c.deckId ?? null;
    // Key layout: cardId|notes|tags|deckId|finish|condition (the row's data-testid
    // is derived from it, so the attributes go last to keep the prefix readable).
    const key = `${c.card.id}|${c.notes ?? ""}|${tagsKey}|${deckId ?? ""}|${attributesKey(c.finish, c.condition)}`;
    const existing = map.get(key);
    if (existing) {
      existing.physicalCardIds.push(c._id);
      existing.quantity++;
    } else {
      map.set(key, {
        key,
        card: c.card,
        notes: c.notes,
        tags: c.tags,
        finish: effectiveFinish(c.finish),
        condition: effectiveCondition(c.condition),
        deckId,
        deckName: c.deckName,
        physicalCardIds: [c._id],
        quantity: 1
      });
    }
  }
  return [...map.values()];
}

/** Rows whose copies are not assigned to any deck (the "hide cards in decks" filter). */
export function excludeDeckRows(rows: CollectionGroupRow[]): CollectionGroupRow[] {
  return rows.filter((r) => r.deckId === null);
}

/**
 * Default order: by card name, then set release date (oldest printing first;
 * missing dates first, matching the server-side sort), then non-foil before
 * foil/etched and best condition first, then loose copies before deck-assigned
 * copies.
 */
export function sortGroupRows(rows: CollectionGroupRow[]): CollectionGroupRow[] {
  return rows.slice().sort((a, b) => {
    const nameCmp = a.card.name.localeCompare(b.card.name);
    if (nameCmp !== 0) return nameCmp;
    const dateCmp = (a.card.released_at ?? "").localeCompare(b.card.released_at ?? "");
    if (dateCmp !== 0) return dateCmp;
    const finishCmp = finishRank(a.finish) - finishRank(b.finish);
    if (finishCmp !== 0) return finishCmp;
    const conditionCmp = conditionRank(a.condition) - conditionRank(b.condition);
    if (conditionCmp !== 0) return conditionCmp;
    if (!a.deckId && b.deckId) return -1;
    if (a.deckId && !b.deckId) return 1;
    return (a.deckName ?? "").localeCompare(b.deckName ?? "");
  });
}

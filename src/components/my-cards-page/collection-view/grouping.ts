import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { MtgCard } from "@/types/MtgCard";

/** One collection-table display row: copies grouped by card + notes + tags + deck. */
export interface CollectionGroupRow {
  key: string;
  card: MtgCard;
  notes?: string;
  tags?: string[];
  /** Single deck membership for this row (null = loose copies). */
  deckId: string | null;
  deckName?: string;
  physicalCardIds: string[];
  quantity: number;
}

/** Shared CSS grid template for the collection table header + rows. */
export const COLLECTION_GRID =
  "2.25rem minmax(160px,1.6fr) 7rem minmax(120px,1fr) 3.5rem 3rem 3.5rem 7rem 9rem";

export function groupCollectionCards(cards: DetailedPhysicalCard[]): CollectionGroupRow[] {
  const map = new Map<string, CollectionGroupRow>();
  for (const c of cards) {
    const tagsKey = (c.tags ?? []).slice().sort().join(",");
    const deckId = c.deckId ?? null;
    const key = `${c.card.id}|${c.notes ?? ""}|${tagsKey}|${deckId ?? ""}`;
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
        deckId,
        deckName: c.deckName,
        physicalCardIds: [c._id],
        quantity: 1
      });
    }
  }
  return [...map.values()];
}

/** Default order: by card name, then loose copies before deck-assigned copies. */
export function sortGroupRows(rows: CollectionGroupRow[]): CollectionGroupRow[] {
  return rows.slice().sort((a, b) => {
    const nameCmp = a.card.name.localeCompare(b.card.name);
    if (nameCmp !== 0) return nameCmp;
    if (!a.deckId && b.deckId) return -1;
    if (a.deckId && !b.deckId) return 1;
    return (a.deckName ?? "").localeCompare(b.deckName ?? "");
  });
}

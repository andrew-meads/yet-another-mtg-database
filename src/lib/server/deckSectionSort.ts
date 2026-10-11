import { z } from "zod";
import { CardData, DeckModel, PhysicalCardModel } from "@/db/schema";
import { objectIdString } from "./deckArrange";
import {
  SECTION_SORT_MODES,
  SectionSortMode,
  SortableCard,
  arrangeSectionColumns
} from "@/lib/deckSectionSort";

/* Sections/columns are Mongoose subdocuments; typed loosely like deckArrange.ts. */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Body of POST /api/decks/[id]/sections/sort. */
export const sectionSortSchema = z.strictObject({
  sectionId: objectIdString,
  mode: z.enum(SECTION_SORT_MODES)
});

export type SortDeckSectionResult = "ok" | "deck-not-found" | "section-not-found";

/**
 * Rebuilds one section's columns by mana value or color (see `arrangeSectionColumns`).
 * Only the deck's own arrays change — no back-refs — so it is a single save. Column ids
 * are regenerated. Any arranged id whose physical card or card data can't be found is
 * kept, appended to the last column, rather than silently dropped.
 */
export async function sortDeckSection(
  userId: string,
  deckId: string,
  sectionId: string,
  mode: SectionSortMode
): Promise<SortDeckSectionResult> {
  const deck = await DeckModel.findOne({ _id: deckId, owner: userId });
  if (!deck) return "deck-not-found";
  const section = deck.sections.find((s: any) => String(s._id) === sectionId) as any;
  if (!section) return "section-not-found";

  const arrangedIds: string[] = section.columns.flatMap((col: any) =>
    col.cards.map((cid: any) => String(cid))
  );

  const physicalCards = await PhysicalCardModel.find(
    { _id: { $in: arrangedIds }, owner: userId },
    { _id: 1, cardId: 1 }
  ).lean();
  const cardIdByPhysical = new Map(physicalCards.map((pc) => [String(pc._id), pc.cardId]));

  const cardDocs = await CardData.find(
    { id: { $in: [...new Set(cardIdByPhysical.values())] } },
    { _id: 0, id: 1, name: 1, cmc: 1, type_line: 1, colors: 1, "card_faces.colors": 1 }
  ).lean();
  const cardById = new Map(cardDocs.map((c: any) => [c.id as string, c]));

  const sortable: SortableCard[] = [];
  const unknown: string[] = [];
  for (const id of arrangedIds) {
    const card: any = cardById.get(cardIdByPhysical.get(id) ?? "");
    if (!card) {
      unknown.push(id);
      continue;
    }
    const colors = new Set<string>(card.colors ?? []);
    (card.card_faces ?? []).forEach((face: any) =>
      (face.colors ?? []).forEach((c: string) => colors.add(c))
    );
    sortable.push({
      id,
      name: card.name ?? "",
      cmc: card.cmc ?? 0,
      typeLine: card.type_line ?? "",
      colors: [...colors]
    });
  }

  const columns = arrangeSectionColumns(sortable, mode);
  if (unknown.length > 0) {
    if (columns.length === 0) columns.push([]);
    columns[columns.length - 1].push(...unknown);
  }
  // A section always keeps at least one column to drop into.
  if (columns.length === 0) columns.push([]);

  section.columns = columns.map((cards) => ({ cards }));
  deck.markModified("sections");
  await deck.save();
  return "ok";
}

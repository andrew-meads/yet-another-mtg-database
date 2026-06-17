import { Types } from "mongoose";
import { DeckModel } from "@/db/schema";

/* These helpers operate on a hydrated Mongoose Deck document. Sections/columns
 * are subdocuments (with runtime _id) so we type loosely to avoid fighting the
 * Mongoose generics. */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Resolves the target column for a placement, defaulting to the first column of
 * the first section and creating a section/column if the deck has none.
 * Returns the column subdocument (its `cards` array can be spliced into).
 */
export function findOrCreateColumn(deck: any, sectionId?: string, columnId?: string): any {
  let section = sectionId
    ? deck.sections.find((s: any) => String(s._id) === sectionId)
    : deck.sections[0];
  if (!section) {
    deck.sections.push({ name: "Main", columns: [{ cards: [] }] });
    section = deck.sections[deck.sections.length - 1];
  }
  let column = columnId
    ? section.columns.find((c: any) => String(c._id) === columnId)
    : section.columns[0];
  if (!column) {
    section.columns.push({ cards: [] });
    column = section.columns[section.columns.length - 1];
  }
  return column;
}

/**
 * Removes a physical-card id from every deck arrangement owned by the user.
 * Used as the "clean slate" step before placing a card into its target column.
 */
export async function pullCardFromAllDecks(userId: string, physicalCardId: string) {
  await DeckModel.updateMany(
    { owner: userId },
    { $pull: { "sections.$[].columns.$[].cards": new Types.ObjectId(physicalCardId) } }
  );
}

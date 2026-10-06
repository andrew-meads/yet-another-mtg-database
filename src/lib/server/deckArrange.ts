import { Types } from "mongoose";
import { z } from "zod";
import { DeckModel, PhysicalCardModel } from "@/db/schema";

/* These helpers operate on a hydrated Mongoose Deck document. Sections/columns
 * are subdocuments (with runtime _id) so we type loosely to avoid fighting the
 * Mongoose generics. */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Most physical cards a single batch request may touch. */
export const MAX_BATCH_CARDS = 500;

export const objectIdString = z.string().regex(/^[0-9a-f]{24}$/i, "must be an ObjectId string");

/** 1..MAX_BATCH_CARDS physical-card ids, deduplicated with their order kept. */
export const physicalCardIdsSchema = z
  .array(objectIdString)
  .min(1, "physicalCardIds must not be empty")
  .max(MAX_BATCH_CARDS, `physicalCardIds must not exceed ${MAX_BATCH_CARDS} entries`)
  .transform((ids) => [...new Set(ids)]);

/** Body of POST /api/decks/[id]/cards. */
export const deckCardOpSchema = z.strictObject({
  op: z.enum(["place", "move", "remove"]),
  physicalCardIds: physicalCardIdsSchema,
  sectionId: z.string().optional(),
  columnId: z.string().optional(),
  index: z.number().int().min(0).optional()
});

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
 * Removes the given physical-card ids from every deck arrangement owned by the user.
 * Used as the "clean slate" step before placing cards into their target column.
 */
export async function pullCardsFromAllDecks(userId: string, physicalCardIds: string[]) {
  await DeckModel.updateMany(
    { owner: userId },
    {
      $pull: {
        "sections.$[].columns.$[].cards": {
          $in: physicalCardIds.map((id) => new Types.ObjectId(id))
        }
      }
    }
  );
}

/**
 * Places (or moves) the given cards into one deck column, in the given order, starting
 * at `index` (appended when omitted). Clears them from any other deck first, so the
 * one-deck invariant holds. Callers must have checked the cards belong to `userId`.
 *
 * `index` is a position in the column as the user saw it, i.e. still containing any of
 * the moved cards. Those are pulled before the splice, so the index is shifted down by
 * the number of moved cards that sat above it, which keeps the drop where it was aimed.
 *
 * Write order: deckId back-refs first, then the arrays.
 *
 * @returns false (and writes nothing) when the deck is not the user's.
 */
export async function placeCardsInDeck(
  userId: string,
  deckId: string,
  physicalCardIds: string[],
  target: { sectionId?: string; columnId?: string; index?: number }
): Promise<boolean> {
  const deck = await DeckModel.findOne({ _id: deckId, owner: userId });
  if (!deck) return false;

  let insertAt = target.index;
  if (insertAt !== undefined) {
    // Read-only use of the pre-pull deck: it is discarded, never saved.
    const before = findOrCreateColumn(deck, target.sectionId, target.columnId);
    const moving = new Set(physicalCardIds);
    const movedAbove = before.cards
      .slice(0, insertAt)
      .filter((id: unknown) => moving.has(String(id))).length;
    insertAt -= movedAbove;
  }

  // (1) back-ref source of truth
  await PhysicalCardModel.updateMany(
    { _id: { $in: physicalCardIds }, owner: userId },
    { $set: { deckId } }
  );

  // (2) clean slate across all decks (removes from prior decks and any stale copy here)
  await pullCardsFromAllDecks(userId, physicalCardIds);

  // (3) reload this deck (its arrays were just modified) and place the cards
  const freshDeck = await DeckModel.findOne({ _id: deckId, owner: userId });
  const column = findOrCreateColumn(freshDeck, target.sectionId, target.columnId);
  const at =
    insertAt === undefined
      ? column.cards.length
      : Math.max(0, Math.min(insertAt, column.cards.length));
  column.cards.splice(at, 0, ...physicalCardIds);
  freshDeck!.markModified("sections");
  await freshDeck!.save();
  return true;
}

/**
 * Pulls the given cards out of every deck. Collection-backed cards keep their collection
 * (deckId cleared); ephemeral cards (no collection) are deleted, since they would
 * otherwise be unreachable. Callers must have checked the cards belong to `userId`.
 */
export async function removeCardsFromDecks(userId: string, physicalCardIds: string[]) {
  await pullCardsFromAllDecks(userId, physicalCardIds);
  await PhysicalCardModel.deleteMany({
    _id: { $in: physicalCardIds },
    owner: userId,
    collectionId: null
  });
  await PhysicalCardModel.updateMany(
    { _id: { $in: physicalCardIds }, owner: userId },
    { $set: { deckId: null } }
  );
}

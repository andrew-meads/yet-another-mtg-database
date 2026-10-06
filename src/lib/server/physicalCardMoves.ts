import { z } from "zod";
import { CollectionModel, PhysicalCardModel } from "@/db/schema";
import { objectIdString, physicalCardIdsSchema } from "./deckArrange";

/** Body of PATCH /api/physical-cards (bulk collection move). */
export const movePhysicalCardsSchema = z.strictObject({
  physicalCardIds: physicalCardIdsSchema,
  collectionId: objectIdString
});

export type MovePhysicalCardsResult = "ok" | "collection-not-found" | "card-not-found";

/**
 * Moves the given cards into `collectionId` with one write. Deck assignments are kept,
 * mirroring the single-card PATCH. Every id and the target are checked first, so
 * nothing is written unless the whole batch can apply.
 */
export async function movePhysicalCardsToCollection(
  userId: string,
  physicalCardIds: string[],
  collectionId: string
): Promise<MovePhysicalCardsResult> {
  const target = await CollectionModel.findOne(
    { _id: collectionId, owner: userId },
    { _id: 1 }
  ).lean();
  if (!target) return "collection-not-found";

  const owned = await PhysicalCardModel.countDocuments({
    _id: { $in: physicalCardIds },
    owner: userId
  });
  if (owned !== physicalCardIds.length) return "card-not-found";

  await PhysicalCardModel.updateMany(
    { _id: { $in: physicalCardIds }, owner: userId },
    { $set: { collectionId } }
  );
  return "ok";
}

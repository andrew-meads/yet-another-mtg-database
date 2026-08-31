import connectDB from "@/db/mongoose";
import { CollectionModel, PhysicalCardModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

/**
 * GET /api/collections/summaries
 * Lightweight list of the authenticated user's collections.
 *
 * @returns { collections: [{ _id, name, description, kind: "collection", isActive, owner, cardCount }] }
 */
export async function GET(_request: NextRequest) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const collections = await CollectionModel.find(
      { owner: userId },
      { _id: 1, name: 1, description: 1, isActive: 1, owner: 1 }
    )
      .sort({ updatedAt: -1 })
      .lean();

    // Card totals come from the PhysicalCard collectionId back-refs (the source
    // of truth for membership).
    const counts = await PhysicalCardModel.aggregate<{ _id: unknown; count: number }>([
      { $match: { collectionId: { $in: collections.map((c) => c._id) } } },
      { $group: { _id: "$collectionId", count: { $sum: 1 } } }
    ]);
    const countByCollectionId = new Map(counts.map((c) => [String(c._id), c.count]));

    return Response.json({
      collections: collections.map((c) => ({
        ...c,
        kind: "collection" as const,
        cardCount: countByCollectionId.get(String(c._id)) ?? 0
      }))
    });
  } catch (error) {
    console.error("Error fetching collection summaries:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

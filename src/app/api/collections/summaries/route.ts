import connectDB from "@/db/mongoose";
import { CollectionModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

/**
 * GET /api/collections/summaries
 * Lightweight list of the authenticated user's collections.
 *
 * @returns { collections: [{ _id, name, kind: "collection", isActive, owner }] }
 */
export async function GET(_request: NextRequest) {
  try {
    await connectDB();

    const session = await getServerSession(authOptions);
    const userId = session!.user._id;

    const collections = await CollectionModel.find(
      { owner: userId },
      { _id: 1, name: 1, isActive: 1, owner: 1 }
    )
      .sort({ updatedAt: -1 })
      .lean();

    return Response.json({
      collections: collections.map((c) => ({ ...c, kind: "collection" as const }))
    });
  } catch (error) {
    console.error("Error fetching collection summaries:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

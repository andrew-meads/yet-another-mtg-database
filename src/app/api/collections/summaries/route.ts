import connectDB from "@/db/mongoose";
import { CardCollectionModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

/**
 * GET /api/collections/summaries
 * Retrieves a lightweight list of card collections owned by the authenticated user (ID, name, type, and owner).
 *
 * Query Parameters:
 * - type: Filter by collectionType: "collection", "wishlist", or "deck" (optional)
 *
 * @returns Response containing array of collections with _id, name, collectionType, isActive, and owner
 *
 * Useful for populating dropdowns and selection lists without fetching full collection data.
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const session = await getServerSession(authOptions);
    const userId = session!.user._id;

    // Get optional type query parameter
    const type = request.nextUrl.searchParams.get("type");

    // Build filter based on type parameter and user ownership
    const filter: any = { owner: userId };
    if (type) {
      filter.collectionType = type;
    }

    const collections = await CardCollectionModel.find(filter, {
      _id: 1,
      name: 1,
      collectionType: 1,
      isActive: 1,
      owner: 1
    })
      .sort({ updatedAt: -1 }) // Sort by last modification time, newest first
      .lean();
    return Response.json({ collections });
  } catch (error) {
    console.error("Error fetching collection names:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

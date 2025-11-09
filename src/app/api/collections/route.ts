import connectDB from "@/db/mongoose";
import { CardCollectionModel } from "@/db/schema";
import { NextRequest } from "next/server";

/**
 * POST /api/collections
 * Creates a new card collection.
 * 
 * Request Body:
 * - name: Collection name (required)
 * - description: Collection description (optional)
 * - collectionType: Type: "collection", "wishlist", or "deck" (required)
 * 
 * @returns Response with created collection and Location header pointing to the new resource
 * 
 * The collection is initialized with an empty cards array.
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const body = await request.json();
    const { name, description, collectionType } = body;

    // Validate required fields
    if (!name || !collectionType) {
      return Response.json(
        { error: "Name and collectionType are required" },
        { status: 400 }
      );
    }

    // Validate collectionType enum
    const validTypes = ["collection", "wishlist", "deck"];
    if (!validTypes.includes(collectionType)) {
      return Response.json(
        { error: `collectionType must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Create new collection with empty cards array
    const newCollection = new CardCollectionModel({
      name,
      description,
      collectionType,
      cards: []
    });

    await newCollection.save();

    return Response.json(
      { collection: newCollection },
      {
        status: 201,
        headers: {
          Location: `/api/collections/${newCollection._id}`
        }
      }
    );
  } catch (error) {
    console.error("Error creating collection:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

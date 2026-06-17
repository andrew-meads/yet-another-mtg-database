import connectDB from "@/db/mongoose";
import { CollectionModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

/**
 * POST /api/collections
 * Creates a new (empty) card collection owned by the authenticated user.
 *
 * Request Body:
 * - name: Collection name (required)
 * - description: Collection description (optional)
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const session = await getServerSession(authOptions);
    const userId = session!.user._id;

    const body = await request.json();
    const { name, description } = body;

    if (!name) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }

    const newCollection = await CollectionModel.create({
      name,
      description: description ?? "",
      owner: userId
    });

    return Response.json(
      { collection: { ...newCollection.toObject(), kind: "collection" } },
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

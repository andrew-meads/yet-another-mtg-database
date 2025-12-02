import connectDB from "@/db/mongoose";
import { CardCollectionModel } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

/**
 * PATCH /api/collections/[id]/isActive
 * Updates the isActive status of a card collection.
 *
 * When setting a collection to active (isActive: true), this will automatically
 * deactivate all other collections, ensuring only one collection can be active at a time.
 *
 * @param request - Request body should contain { isActive: boolean }
 * @param params - Route params containing collection id
 * @returns 200 with updated collection on success
 * @returns 400 if isActive is not a boolean
 * @returns 404 if collection not found (no database updates will occur)
 * @returns 500 on server error
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();

    const { id } = await params;
    const body = await request.json();

    // Validate isActive is a boolean
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be a boolean value" }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const userId = session!.user._id;

    // Check if the collection exists and is owned by the current user
    const existingCollection = await CardCollectionModel.findOne({ _id: id, owner: userId });

    if (!existingCollection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    // If setting a collection to active, first deactivate all other collections owned by this user
    if (body.isActive === true) {
      await CardCollectionModel.updateMany({ _id: { $ne: id }, owner: userId }, { isActive: false });
    }

    // Update the collection's isActive status
    const updatedCollection = await CardCollectionModel.findOneAndUpdate(
      { _id: id, owner: userId },
      { isActive: body.isActive },
      { new: true } // Return the updated document
    );

    return NextResponse.json(updatedCollection);
  } catch (error) {
    console.error("Error updating collection isActive status:", error);
    return NextResponse.json({ error: "Failed to update collection" }, { status: 500 });
  }
}

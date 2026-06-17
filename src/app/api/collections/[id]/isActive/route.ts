import connectDB from "@/db/mongoose";
import { CollectionModel } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

/**
 * PATCH /api/collections/[id]/isActive
 * Updates the isActive status of a collection. Setting one active deactivates all
 * other collections owned by the user (only one active collection at a time).
 *
 * @param request - Request body should contain { isActive: boolean }
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();

    const { id } = await params;
    const body = await request.json();

    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be a boolean value" }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const userId = session!.user._id;

    const existingCollection = await CollectionModel.findOne({ _id: id, owner: userId });
    if (!existingCollection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    if (body.isActive === true) {
      await CollectionModel.updateMany({ _id: { $ne: id }, owner: userId }, { isActive: false });
    }

    const updatedCollection = await CollectionModel.findOneAndUpdate(
      { _id: id, owner: userId },
      { isActive: body.isActive },
      { new: true }
    ).lean();

    return NextResponse.json({ ...updatedCollection, kind: "collection" });
  } catch (error) {
    console.error("Error updating collection isActive status:", error);
    return NextResponse.json({ error: "Failed to update collection" }, { status: 500 });
  }
}

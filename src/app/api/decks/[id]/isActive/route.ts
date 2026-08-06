import connectDB from "@/db/mongoose";
import { DeckModel } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/auth";

/**
 * PATCH /api/decks/[id]/isActive
 * Updates the isActive status of a deck. Setting one active deactivates all other
 * decks owned by the user (only one active deck at a time). The active deck is
 * independent of the active collection — both can be active simultaneously.
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

    const session = await getAuthSession();
    const userId = session!.user._id;

    const existingDeck = await DeckModel.findOne({ _id: id, owner: userId });
    if (!existingDeck) {
      return NextResponse.json({ error: "Deck not found" }, { status: 404 });
    }

    if (body.isActive === true) {
      await DeckModel.updateMany({ _id: { $ne: id }, owner: userId }, { isActive: false });
    }

    const updatedDeck = await DeckModel.findOneAndUpdate(
      { _id: id, owner: userId },
      { isActive: body.isActive },
      { returnDocument: "after" }
    ).lean();

    return NextResponse.json({ ...updatedDeck, kind: "deck" });
  } catch (error) {
    console.error("Error updating deck isActive status:", error);
    return NextResponse.json({ error: "Failed to update deck" }, { status: 500 });
  }
}

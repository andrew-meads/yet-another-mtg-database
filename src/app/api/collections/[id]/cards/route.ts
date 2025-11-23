import { NextResponse } from "next/server";
import connectDB from "@/db/mongoose";
import { CardCollectionModel } from "@/db/schema";
import { CardEntry } from "@/types/CardCollection";

/**
 * PATCH /api/collections/[id]/cards
 * Adds a CardEntry to the cards array of the collection with the given id.
 *
 * Request Body:
 * - CardEntry object (see types/CardCollection.ts)
 *
 * @returns The updated collection, or 404 if collection not found
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cardEntry: CardEntry = await request.json();

    // Basic validation for required fields
    if (
      !cardEntry ||
      typeof cardEntry.cardId !== "string" ||
      typeof cardEntry.quantity !== "number"
    ) {
      return NextResponse.json(
        { error: "Invalid CardEntry: cardId and quantity are required." },
        { status: 400 }
      );
    }

    await connectDB();

    const collection = await CardCollectionModel.findById(id);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    // Find an existing entry with matching cardId, notes, and tags
    const match = collection.cards.find(
      (e) =>
        e.cardId === cardEntry.cardId &&
        (e.notes || "") === (cardEntry.notes || "") &&
        JSON.stringify(e.tags || []) === JSON.stringify(cardEntry.tags || [])
    );
    if (match) {
      match.quantity += cardEntry.quantity;
    } else {
      collection.cards.push(cardEntry);
    }
    collection.markModified("cards");

    await collection.save();
    return NextResponse.json({ collection });
  } catch (error) {
    console.error("Error adding card entry:", error);
    return NextResponse.json({ error: "Failed to add card entry" }, { status: 500 });
  }
}

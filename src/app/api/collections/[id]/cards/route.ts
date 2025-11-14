import { NextResponse } from "next/server";
import connectDB from "@/db/mongoose";
import { CardCollectionModel } from "@/db/schema";
import { CardModification } from "@/types/CardModification";
import { CardEntry } from "@/types/CardCollection";

/**
 * Set exact quantity for a card
 * Removes the card if amount is 0
 */
function setCardQuantity(cards: CardEntry[], cardId: string, amount: number): void {
  const existingCardIndex = cards.findIndex((c) => c.cardId === cardId);

  if (amount === 0) {
    // Remove card if setting to 0
    if (existingCardIndex !== -1) {
      cards.splice(existingCardIndex, 1);
    }
  } else {
    if (existingCardIndex !== -1) {
      cards[existingCardIndex].quantity = amount;
    } else {
      // Add new card entry
      cards.push({ cardId, quantity: amount });
    }
  }
}

/**
 * Add to card quantity
 * Creates new entry if card doesn't exist
 */
function addCardQuantity(cards: CardEntry[], cardId: string, amount: number): void {
  const existingCardIndex = cards.findIndex((c) => c.cardId === cardId);

  if (existingCardIndex !== -1) {
    cards[existingCardIndex].quantity += amount;
  } else {
    // Add new card entry
    cards.push({ cardId, quantity: amount });
  }
}

/**
 * Subtract from card quantity
 * Removes card if quantity reaches 0 or below
 * Does nothing if card doesn't exist
 */
function subtractCardQuantity(cards: CardEntry[], cardId: string, amount: number): void {
  const existingCardIndex = cards.findIndex((c) => c.cardId === cardId);

  if (existingCardIndex !== -1) {
    const newQuantity = cards[existingCardIndex].quantity - amount;
    if (newQuantity <= 0) {
      // Remove card if quantity becomes 0 or negative
      cards.splice(existingCardIndex, 1);
    } else {
      cards[existingCardIndex].quantity = newQuantity;
    }
  }
  // If card doesn't exist, do nothing (can't subtract from nothing)
}

/**
 * PATCH /api/collections/[id]/cards
 *
 * Modify the quantities of cards in a collection
 *
 * Request body: Array of CardModification objects
 * - cardId: The ID of the card to modify
 * - operator: "add" (increase quantity), "subtract" (decrease quantity), or "set" (set exact quantity)
 * - amount: The amount to add/subtract/set
 *
 * Returns the updated collection
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Parse request body
    const modifications: CardModification[] = await request.json();

    // Validate input
    if (!Array.isArray(modifications)) {
      return NextResponse.json(
        { error: "Request body must be an array of modifications" },
        { status: 400 }
      );
    }

    // Validate each modification
    for (const mod of modifications) {
      if (!mod.cardId || typeof mod.cardId !== "string") {
        return NextResponse.json(
          { error: "Each modification must have a valid cardId" },
          { status: 400 }
        );
      }

      if (!["add", "subtract", "set"].includes(mod.operator)) {
        return NextResponse.json(
          { error: "Operator must be 'add', 'subtract', or 'set'" },
          { status: 400 }
        );
      }

      if (typeof mod.amount !== "number" || mod.amount < 0) {
        return NextResponse.json(
          { error: "Amount must be a non-negative number" },
          { status: 400 }
        );
      }
    }

    // Connect to database
    await connectDB();

    // Find the collection
    const collection = await CardCollectionModel.findById(id);

    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    // Apply each modification
    for (const mod of modifications) {
      if (mod.operator === "set") {
        setCardQuantity(collection.cards, mod.cardId, mod.amount);
      } else if (mod.operator === "add") {
        addCardQuantity(collection.cards, mod.cardId, mod.amount);
      } else if (mod.operator === "subtract") {
        subtractCardQuantity(collection.cards, mod.cardId, mod.amount);
      }
    }

    // Save the updated collection
    await collection.save();

    return NextResponse.json({ collection });
  } catch (error) {
    console.error("Error modifying collection cards:", error);
    return NextResponse.json({ error: "Failed to modify collection cards" }, { status: 500 });
  }
}

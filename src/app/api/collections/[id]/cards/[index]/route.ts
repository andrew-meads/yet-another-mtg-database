import connectDB from "@/db/mongoose";
import { CardCollectionModel } from "@/db/schema";
import { TagModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

/**
 * PATCH /api/collections/[id]/cards/[index]
 * Updates the notes and/or tags of a specific card entry in a collection.
 *
 * Request Body (at least one field required):
 * - notes: String with notes for the card entry (optional)
 * - tags: Array of tag strings (optional)
 * - quantity: Number to update the quantity of the card entry (optional)
 *
 * @returns The updated collection, or 404 if collection/entry not found
 *
 * Note: The index parameter refers to the position of the card in the collection's cards array.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/collections/[id]/cards/[index]">
) {
  try {
    await connectDB();

    const { id, index } = await ctx.params;
    const body = await request.json();
    const { notes, tags, quantity } = body;

    // Validate that at least one field is provided
    if (notes === undefined && tags === undefined && quantity === undefined) {
      return Response.json(
        { error: "At least one field required: notes, tags, quantity" },
        { status: 400 }
      );
    }

    // Parse and validate index
    const cardIndex = parseInt(index, 10);
    if (isNaN(cardIndex) || cardIndex < 0) {
      return Response.json({ error: "Invalid index parameter" }, { status: 400 });
    }

    // Use atomic update for the card entry
    // Build the update object and arrayFilters
    const update: any = {};
    const arrayFilters: any[] = [{ "elemIndex": cardIndex }];

    if (notes !== undefined) {
      update[`cards.${cardIndex}.notes`] = notes;
    }
    if (tags !== undefined) {
      update[`cards.${cardIndex}.tags`] = tags;
      await updateTags(tags);
    }
    if (quantity !== undefined) {
      update[`cards.${cardIndex}.quantity`] = quantity;
    }

    const session = await getServerSession(authOptions);
    const userId = session!.user._id;

    // If quantity is 0, use $unset to remove the entry
    let result;
    if (quantity === 0) {
      result = await CardCollectionModel.findOneAndUpdate(
        { _id: id, owner: userId },
        { $unset: { [`cards.${cardIndex}`]: 1 } },
        { new: true }
      );
      // Remove any nulls left in the array
      if (result) {
        result.cards = result.cards.filter(Boolean);
        await result.save();
      }
    } else {
      result = await CardCollectionModel.findOneAndUpdate(
        { _id: id, owner: userId },
        { $set: update },
        { new: true }
      );
    }

    if (!result) {
      return Response.json({ error: "Collection not found or update failed" }, { status: 404 });
    }
    return Response.json({ collection: result.toObject() });
  } catch (error) {
    console.error("Error updating card entry:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Adds new tags to the Tag database if they do not already exist
 *
 * @param tags the array of tags to update
 */
async function updateTags(tags: string[]) {
  if (!Array.isArray(tags)) return;
  if (tags.length === 0) return;

  // Add any new tags to the Tag database
  const existingTags = await TagModel.find({ label: { $in: tags } }, { label: 1, _id: 0 }).lean();
  const existingLabels = new Set(existingTags.map((tag: { label: string }) => tag.label));
  const newLabels = tags.filter((label) => !existingLabels.has(label));
  if (newLabels.length > 0) {
    await TagModel.insertMany(
      newLabels.map((label) => new TagModel({ label })),
      { ordered: false }
    );
  }
}

/**
 * DELETE /api/collections/[id]/cards/[index]
 * Removes a card entry from a collection by its index
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/collections/[id]/cards/[index]">
) {
  try {
    await connectDB();
    const { id, index } = await ctx.params;
    const cardIndex = parseInt(index, 10);
    if (isNaN(cardIndex) || cardIndex < 0) {
      return Response.json({ error: "Invalid index parameter" }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const userId = session!.user._id;

    const collection = await CardCollectionModel.findOne({ _id: id, owner: userId });
    if (!collection) {
      return Response.json({ error: "Collection not found" }, { status: 404 });
    }
    if (cardIndex >= collection.cards.length) {
      return Response.json(
        {
          error: `Card index ${cardIndex} out of bounds. Collection has ${collection.cards.length} cards.`
        },
        { status: 404 }
      );
    }
    // Remove the card entry at the given index
    collection.cards.splice(cardIndex, 1);
    collection.markModified("cards");
    await collection.save();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting card entry:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

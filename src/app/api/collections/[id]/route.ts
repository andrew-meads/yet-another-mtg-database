import connectDB from "@/db/mongoose";
import { CardCollectionModel, Card } from "@/db/schema";
import { CardCollectionWithCards } from "@/types/CardCollection";
import { NextRequest } from "next/server";

/**
 * GET /api/collections/[id]
 * Retrieves a single card collection by its ID.
 * 
 * Query Parameters:
 * - details: If "true", includes full card details in the response (optional)
 * 
 * @returns The collection object, or 404 if not found
 * 
 * Behavior:
 * - Without details param: Returns collection with card IDs, quantities, notes, and tags
 * - With ?details=true: Populates full MTG card data for each card in the collection
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/collections/[id]">) {
  try {
    await connectDB();

    const { id } = await ctx.params;
    const collection = await CardCollectionModel.findById(id).lean();

    if (!collection) {
      return Response.json({ error: "Collection not found" }, { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const includeCardDetails = searchParams.get("details")?.toLowerCase() === "true";
    if (!includeCardDetails) return Response.json({ collection });

    // Populate card details if requested
    const detailsCollection: CardCollectionWithCards = {
      ...collection,
      cardsDetailed: []
    };

    const cardIds = collection.cards.map((c) => c.cardId);
    const mtgCards = await Card.find({ id: { $in: cardIds } }).lean();

    detailsCollection.cardsDetailed = collection.cards.map((colCard) => {
      const cardDetail = mtgCards.find((mc) => mc.id === colCard.cardId);
      return {
        _id: colCard._id,
        card: cardDetail!,
        quantity: colCard.quantity,
        notes: colCard.notes,
        tags: colCard.tags
      };
    });

    return Response.json({ collection: detailsCollection });
  } catch (error) {
    console.error("Error fetching collection:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/collections/[id]
 * Updates an existing card collection.
 * 
 * Request Body (all fields optional, partial updates supported):
 * - name: Collection name
 * - description: Collection description
 * - cards: Array of card objects with cardId, quantity, notes, and tags
 * 
 * @returns The updated collection, or 404 if not found
 * 
 * Note: Fields _id and collectionType cannot be modified.
 * Only provided fields will be updated; omitted fields remain unchanged.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/collections/[id]">) {
  try {
    await connectDB();

    const { id } = await ctx.params;
    const body = await request.json();
    const { name, description, cards } = body;

    // Build update object only with allowed fields that are provided
    const update: Record<string, any> = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (cards !== undefined) update.cards = cards;

    // Check if there are any valid fields to update
    if (Object.keys(update).length === 0) {
      return Response.json(
        { error: "No valid fields provided. Allowed fields: name, description, cards" },
        { status: 400 }
      );
    }

    // Find and update the collection
    const collection = await CardCollectionModel.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true
    });

    if (!collection) {
      return Response.json({ error: "Collection not found" }, { status: 404 });
    }

    return Response.json({ collection });
  } catch (error) {
    console.error("Error updating collection:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

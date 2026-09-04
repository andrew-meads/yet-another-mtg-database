import connectDB from "@/db/mongoose";
import { CardData, CollectionModel, PhysicalCardModel, DeckModel } from "@/db/schema";
import { CollectionWithCardEntries } from "@/types/Collection";
import { detailPhysicalCards } from "@/lib/server/cardDetails";
import { parseSearchQuery } from "@/lib/search/queryBuilder";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { getAuthSession } from "@/auth";

/**
 * GET /api/collections/[id]
 * Retrieves a single collection by id.
 *
 * Query Parameters:
 * - details: If "true", includes the collection's physical card entries (flat
 *   list; the client groups + sorts) plus a deduplicated top-level `cardData`
 *   map keyed by Scryfall id — the client re-joins entries to card data.
 * - q: Optional Scryfall-style search string. When present (with details=true),
 *   only cards in this collection matching the query are returned. Uses the same
 *   `parseSearchQuery` engine as GET /api/cards.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/collections/[id]">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    // A malformed id can't be anyone's collection — 404 rather than a CastError 500.
    const collection = Types.ObjectId.isValid(id)
      ? await CollectionModel.findOne({ _id: id, owner: userId }).lean()
      : null;

    if (!collection) {
      return Response.json({ error: "Collection not found" }, { status: 404 });
    }

    const summary = {
      _id: collection._id.toString(),
      name: collection.name,
      description: collection.description ?? "",
      isActive: collection.isActive ?? false,
      owner: collection.owner.toString(),
      kind: "collection" as const
    };

    const includeCardDetails =
      request.nextUrl.searchParams.get("details")?.toLowerCase() === "true";
    if (!includeCardDetails) return Response.json({ collection: summary });

    // Optional Scryfall-style search, scoped to this collection. We resolve the
    // query against CardData (intersected with the card ids present here) FIRST
    // so we only ever load the matching physical cards.
    const queryString = request.nextUrl.searchParams.get("q");
    const physicalCardFilter: Record<string, unknown> = { collectionId: id, owner: userId };
    if (queryString && queryString.trim().length > 0) {
      const searchQuery = parseSearchQuery(queryString);
      const cardIds: string[] = await PhysicalCardModel.distinct("cardId", {
        collectionId: id,
        owner: userId
      });
      const matches = await CardData.find(
        { $and: [searchQuery, { id: { $in: cardIds } }] },
        { id: 1 }
      ).lean();
      physicalCardFilter.cardId = { $in: matches.map((m) => m.id) };
    }

    const physicalCards = await PhysicalCardModel.find(physicalCardFilter).lean();
    const { entries, cardData } = await detailPhysicalCards(physicalCards);

    const detailsCollection: CollectionWithCardEntries = {
      ...summary,
      cards: entries
    };

    return Response.json({ collection: detailsCollection, cardData });
  } catch (error) {
    console.error("Error fetching collection:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface PatchCollectionBody {
  name?: string;
  description?: string;
}

/**
 * PATCH /api/collections/[id]
 * Updates a collection's name and/or description.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/collections/[id]">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const { name, description } = (await request.json()) as PatchCollectionBody;

    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;

    if (Object.keys(update).length === 0) {
      return Response.json(
        { error: "No valid fields provided. Allowed fields: name, description" },
        { status: 400 }
      );
    }

    const collection = await CollectionModel.findOneAndUpdate({ _id: id, owner: userId }, update, {
      returnDocument: "after",
      runValidators: true
    }).lean();

    if (!collection) {
      return Response.json({ error: "Collection not found" }, { status: 404 });
    }

    return Response.json({ collection: { ...collection, kind: "collection" } });
  } catch (error) {
    console.error("Error updating collection:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/collections/[id]
 * Deletes a collection and all its physical cards. Any of those cards that are
 * assigned to a deck are also pulled out of that deck's arrangement.
 *
 * Write order: (1) pull the doomed cards from any deck arrays, (2) delete the
 * physical cards, (3) delete the collection.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/collections/[id]">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const collection = await CollectionModel.findOne({ _id: id, owner: userId }).lean();
    if (!collection) {
      return Response.json({ error: "Collection not found" }, { status: 404 });
    }

    const cards = await PhysicalCardModel.find(
      { collectionId: id, owner: userId },
      { _id: 1 }
    ).lean();
    const cardIds = cards.map((c) => c._id);

    // (1) Remove these cards from every deck's columns.
    await DeckModel.updateMany(
      { owner: userId },
      { $pull: { "sections.$[].columns.$[].cards": { $in: cardIds } } }
    );

    // (2) Delete the physical cards, then (3) the collection.
    await PhysicalCardModel.deleteMany({ collectionId: id, owner: userId });
    await CollectionModel.deleteOne({ _id: id, owner: userId });

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting collection:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

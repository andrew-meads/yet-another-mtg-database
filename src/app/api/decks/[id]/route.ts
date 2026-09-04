import connectDB from "@/db/mongoose";
import { DeckModel, PhysicalCardModel } from "@/db/schema";
import { loadDeckWithCards } from "@/lib/server/deckLoad";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { getAuthSession } from "@/auth";

/**
 * GET /api/decks/[id]
 * Retrieves a deck. With ?details=true, returns the nested section/column
 * arrangement of physical-card entries (with collection badges) plus a
 * deduplicated top-level `cardData` map keyed by Scryfall id — the client
 * re-joins entries to card data. See loadDeckWithCards for the reconciliation
 * of the arrangement against the deckId back-refs.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/decks/[id]">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const includeDetails = request.nextUrl.searchParams.get("details")?.toLowerCase() === "true";

    // A malformed id can't be anyone's deck — 404 rather than a CastError 500.
    if (!Types.ObjectId.isValid(id)) {
      return Response.json({ error: "Deck not found" }, { status: 404 });
    }

    if (!includeDetails) {
      const deck = await DeckModel.findOne({ _id: id, owner: userId }).lean();
      if (!deck) {
        return Response.json({ error: "Deck not found" }, { status: 404 });
      }
      return Response.json({
        deck: {
          _id: String(deck._id),
          name: deck.name,
          description: deck.description ?? "",
          isActive: deck.isActive ?? false,
          owner: String(deck.owner),
          kind: "deck" as const
        }
      });
    }

    const loaded = await loadDeckWithCards(id, userId);
    if (!loaded) {
      return Response.json({ error: "Deck not found" }, { status: 404 });
    }
    return Response.json({ deck: loaded.deck, cardData: loaded.cardData });
  } catch (error) {
    console.error("Error fetching deck:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/decks/[id]
 * Updates a deck's name and/or description.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/decks/[id]">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const { name, description } = await request.json();

    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;

    if (Object.keys(update).length === 0) {
      return Response.json({ error: "No valid fields provided" }, { status: 400 });
    }

    const deck = await DeckModel.findOneAndUpdate({ _id: id, owner: userId }, update, {
      returnDocument: "after"
    }).lean();
    if (!deck) {
      return Response.json({ error: "Deck not found" }, { status: 404 });
    }

    return Response.json({ deck: { ...deck, kind: "deck" } });
  } catch (error) {
    console.error("Error updating deck:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/decks/[id]
 * Deletes a deck. Collection-backed cards stay in their collections (deckId
 * cleared first); ephemeral (no-collection) cards are deleted with the deck,
 * since they have no collection to fall back to.
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/decks/[id]">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const deck = await DeckModel.findOne({ _id: id, owner: userId }, { _id: 1 }).lean();
    if (!deck) {
      return Response.json({ error: "Deck not found" }, { status: 404 });
    }

    // Ephemeral cards (no collection) cannot survive without a deck — delete them.
    await PhysicalCardModel.deleteMany({
      deckId: id,
      owner: userId,
      collectionId: null
    });
    // Collection-backed cards just lose their deck assignment.
    await PhysicalCardModel.updateMany(
      { deckId: id, owner: userId, collectionId: { $ne: null } },
      { deckId: null }
    );
    await DeckModel.deleteOne({ _id: id, owner: userId });

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting deck:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

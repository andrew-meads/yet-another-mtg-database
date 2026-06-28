import connectDB from "@/db/mongoose";
import { DeckModel, PhysicalCardModel } from "@/db/schema";
import { DeckWithCards } from "@/types/Deck";
import { detailPhysicalCards } from "@/lib/server/cardDetails";
import { findOrCreateColumn } from "@/lib/server/deckArrange";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET /api/decks/[id]
 * Retrieves a deck. With ?details=true, returns the nested section/column
 * arrangement with each card joined to its data + collection badge.
 *
 * Reconciles arrangement from the deckId back-ref: any physical card pointing at
 * this deck but missing from the arrays is appended to a default column.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/decks/[id]">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const deck = await DeckModel.findOne({ _id: id, owner: userId });
    if (!deck) {
      return Response.json({ error: "Deck not found" }, { status: 404 });
    }

    const summary = {
      _id: String(deck._id),
      name: deck.name,
      description: deck.description ?? "",
      owner: String(deck.owner),
      kind: "deck" as const
    };

    const includeDetails = request.nextUrl.searchParams.get("details")?.toLowerCase() === "true";
    if (!includeDetails) return Response.json({ deck: summary });

    // Reconcile: append any owned-by-this-deck cards missing from the arrangement.
    const arranged = new Set<string>();
    deck.sections.forEach((s: any) =>
      s.columns.forEach((col: any) => col.cards.forEach((cid: any) => arranged.add(String(cid))))
    );
    const owned = await PhysicalCardModel.find({ deckId: id, owner: userId }, { _id: 1 }).lean();
    const orphanIds = owned.map((o) => o._id).filter((oid) => !arranged.has(String(oid)));
    if (orphanIds.length > 0) {
      const column = findOrCreateColumn(deck);
      column.cards.push(...orphanIds);
      deck.markModified("sections");
      await deck.save();
    }

    // Gather all arranged ids and detail them.
    const allIds: string[] = [];
    deck.sections.forEach((s: any) =>
      s.columns.forEach((col: any) => col.cards.forEach((cid: any) => allIds.push(String(cid))))
    );
    const physicalCards = await PhysicalCardModel.find({
      _id: { $in: allIds },
      owner: userId
    }).lean();
    const detailed = await detailPhysicalCards(physicalCards);
    const detailedMap = new Map(detailed.map((d) => [d._id, d]));

    const deckWithCards: DeckWithCards = {
      ...summary,
      sections: deck.sections.map((s: any) => ({
        _id: String(s._id),
        name: s.name,
        columns: s.columns.map((col: any) => ({
          _id: String(col._id),
          cards: col.cards
            .map((cid: any) => detailedMap.get(String(cid)))
            .filter((c: any): c is NonNullable<typeof c> => Boolean(c))
        }))
      }))
    };

    return Response.json({ deck: deckWithCards });
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

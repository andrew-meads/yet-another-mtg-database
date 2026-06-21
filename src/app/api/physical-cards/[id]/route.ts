import connectDB from "@/db/mongoose";
import { PhysicalCardModel, CollectionModel } from "@/db/schema";
import { upsertTags } from "@/lib/server/cardDetails";
import { pullCardFromAllDecks } from "@/lib/server/deckArrange";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

interface PatchPhysicalCardBody {
  notes?: string;
  tags?: string[];
  /** Move the card to a different collection (keeps its deck assignment). */
  collectionId?: string;
}

/**
 * PATCH /api/physical-cards/[id]
 * Updates a physical card's notes/tags and/or moves it to a different collection.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/physical-cards/[id]">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const { notes, tags, collectionId } = (await request.json()) as PatchPhysicalCardBody;

    const card = await PhysicalCardModel.findOne({ _id: id, owner: userId });
    if (!card) {
      return Response.json({ error: "Physical card not found" }, { status: 404 });
    }

    if (notes !== undefined) card.notes = notes;
    if (tags !== undefined) {
      await upsertTags(tags);
      card.tags = tags;
    }
    if (collectionId !== undefined) {
      const target = await CollectionModel.findOne(
        { _id: collectionId, owner: userId },
        { _id: 1 }
      ).lean();
      if (!target) {
        return Response.json({ error: "Target collection not found" }, { status: 400 });
      }
      card.collectionId = collectionId as never;
    }

    await card.save();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error updating physical card:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/physical-cards/[id]
 * Deletes a single physical card, first pulling it from any deck arrangement.
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/physical-cards/[id]">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const card = await PhysicalCardModel.findOne({ _id: id, owner: userId }, { deckId: 1 }).lean();
    if (!card) {
      return new Response(null, { status: 204 });
    }

    if (card.deckId) {
      await pullCardFromAllDecks(userId, id);
    }
    await PhysicalCardModel.deleteOne({ _id: id, owner: userId });

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting physical card:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

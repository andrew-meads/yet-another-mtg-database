import connectDB from "@/db/mongoose";
import { PhysicalCardModel } from "@/db/schema";
import { Types } from "mongoose";
import { deckCardOpSchema, placeCardsInDeck, removeCardsFromDecks } from "@/lib/server/deckArrange";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

/**
 * POST /api/decks/[id]/cards
 * Places, moves, or removes a batch of physical cards within this deck's arrangement.
 * Body: { op, physicalCardIds: string[], sectionId?, columnId?, index? }.
 *
 * - "place"/"move": assign the cards to this deck (clearing any prior deck) and
 *   splice them, in order, into the target section/column at `index`.
 * - "remove": pull the cards from all deck arrays. A normal card keeps its
 *   collection (deck assignment cleared); an ephemeral card (no collection) is
 *   deleted entirely, since it would otherwise be unreachable.
 *
 * Every id is checked before anything is written: one unknown id 404s the whole batch.
 * Write order: update the deckId back-refs first, then fix up the arrays.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/decks/[id]/cards">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const parsed = deckCardOpSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: `Invalid request: ${parsed.error.issues[0]?.message ?? "bad request"}` },
        { status: 400 }
      );
    }
    const { op, physicalCardIds, sectionId, columnId, index } = parsed.data;

    const owned = await PhysicalCardModel.countDocuments({
      _id: { $in: physicalCardIds },
      owner: userId
    });
    if (owned !== physicalCardIds.length) {
      return Response.json({ error: "Physical card not found" }, { status: 404 });
    }

    if (op === "remove") {
      await removeCardsFromDecks(userId, physicalCardIds);
      return Response.json({ ok: true });
    }

    // A malformed id can't be anyone's deck — 404 rather than a CastError 500.
    const placed =
      Types.ObjectId.isValid(id) &&
      (await placeCardsInDeck(userId, id, physicalCardIds, {
        sectionId,
        columnId,
        index
      }));
    if (!placed) {
      return Response.json({ error: "Deck not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error updating deck cards:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

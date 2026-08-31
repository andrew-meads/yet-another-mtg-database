import connectDB from "@/db/mongoose";
import { DeckModel, PhysicalCardModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/decks/[id]/archive
 * Dismantles the deck while keeping the decklist: every collection-backed card
 * returns to its collection (deckId cleared) and is replaced in place — same
 * section, column, and index — by a new ephemeral card of the same printing.
 * Cards that are already ephemeral are left untouched.
 *
 * Write order (no transactions): create the ephemeral back-refs first, then
 * release the real cards, then rewrite the arrays — a mid-failure leaves only
 * orphaned ephemerals, which GET ?details=true reconciles into a default column.
 */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/decks/[id]/archive">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const deck = await DeckModel.findOne({ _id: id, owner: userId });
    if (!deck) {
      return Response.json({ error: "Deck not found" }, { status: 404 });
    }

    const realCards = await PhysicalCardModel.find({
      deckId: id,
      owner: userId,
      collectionId: { $ne: null }
    }).lean();
    if (realCards.length === 0) {
      return Response.json({ ok: true, archived: 0 });
    }

    // (1) One ephemeral placeholder per real card. Notes/tags stay with the
    // physical copy — the placeholder only records "a copy of this printing".
    const ephemerals = await PhysicalCardModel.insertMany(
      realCards.map((real) => ({
        owner: userId,
        cardId: real.cardId,
        collectionId: null,
        deckId: id
      }))
    );
    const replacement = new Map(realCards.map((real, i) => [String(real._id), ephemerals[i]._id]));

    // (2) Real cards return to their collections.
    await PhysicalCardModel.updateMany(
      { _id: { $in: realCards.map((c) => c._id) }, owner: userId },
      { deckId: null }
    );

    // (3) Swap each real id for its placeholder in place, preserving positions.
    deck.sections.forEach((s: any) =>
      s.columns.forEach((col: any) => {
        col.cards = col.cards.map((cid: any) => replacement.get(String(cid)) ?? cid);
      })
    );
    deck.markModified("sections");
    await deck.save();

    return Response.json({ ok: true, archived: realCards.length });
  } catch (error) {
    console.error("Error archiving deck:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

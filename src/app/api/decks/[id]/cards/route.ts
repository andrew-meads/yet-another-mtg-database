import connectDB from "@/db/mongoose";
import { DeckModel, PhysicalCardModel } from "@/db/schema";
import { findOrCreateColumn, pullCardFromAllDecks } from "@/lib/server/deckArrange";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

interface DeckCardsBody {
  op: "place" | "move" | "remove";
  physicalCardId: string;
  sectionId?: string;
  columnId?: string;
  index?: number;
}

/**
 * POST /api/decks/[id]/cards
 * Places, moves, or removes a physical card within this deck's arrangement.
 *
 * - "place"/"move": assign the card to this deck (clearing any prior deck) and
 *   splice it into the target section/column at `index`.
 * - "remove": clear the card's deck assignment and pull it from all deck arrays.
 *   The card stays in its collection.
 *
 * Write order: update the deckId back-ref first, then fix up the arrays.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/decks/[id]/cards">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const { op, physicalCardId, sectionId, columnId, index } =
      (await request.json()) as DeckCardsBody;

    const card = await PhysicalCardModel.findOne({ _id: physicalCardId, owner: userId });
    if (!card) {
      return Response.json({ error: "Physical card not found" }, { status: 404 });
    }

    if (op === "remove") {
      card.deckId = null;
      await card.save();
      await pullCardFromAllDecks(userId, physicalCardId);
      return Response.json({ ok: true });
    }

    if (op === "place" || op === "move") {
      const deck = await DeckModel.findOne({ _id: id, owner: userId });
      if (!deck) {
        return Response.json({ error: "Deck not found" }, { status: 404 });
      }

      // (1) back-ref source of truth
      card.deckId = id as never;
      await card.save();

      // (2) clean slate across all decks (removes from prior deck and any stale copy here)
      await pullCardFromAllDecks(userId, physicalCardId);

      // (3) reload this deck (its arrays were just modified) and place the card
      const freshDeck = await DeckModel.findOne({ _id: id, owner: userId });
      const column = findOrCreateColumn(freshDeck, sectionId, columnId);
      const at =
        typeof index === "number"
          ? Math.max(0, Math.min(index, column.cards.length))
          : column.cards.length;
      column.cards.splice(at, 0, physicalCardId);
      freshDeck!.markModified("sections");
      await freshDeck!.save();

      return Response.json({ ok: true });
    }

    return Response.json({ error: "Invalid op" }, { status: 400 });
  } catch (error) {
    console.error("Error updating deck cards:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

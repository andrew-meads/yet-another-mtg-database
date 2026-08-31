import connectDB from "@/db/mongoose";
import { DeckModel, PhysicalCardModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { getAuthSession } from "@/auth";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FillSwap {
  ephemeralId: string;
  physicalCardId: string;
}

interface FillDeckBody {
  swaps: FillSwap[];
}

/**
 * POST /api/decks/[id]/fill
 * Replaces ephemeral placeholders in this deck with real collection-backed
 * cards, in place — each `physicalCardId` takes over its `ephemeralId`'s exact
 * slot in the arrangement, and the ephemeral is deleted.
 *
 * The whole request is validated before anything is written (no partial
 * application on 400). The real card may live in any of the user's collections
 * and may currently be in another deck (it gets pulled out); which collection
 * counts as "active" is a client concept the server doesn't enforce.
 *
 * Write order (no transactions): pull the real cards from all deck arrays,
 * point their deckId here, delete the ephemerals, then rewrite this deck's
 * arrays — a mid-failure leaves back-refs that GET ?details=true reconciles.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/decks/[id]/fill">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { id } = await ctx.params;
    const deck = await DeckModel.findOne({ _id: id, owner: userId }, { _id: 1 }).lean();
    if (!deck) {
      return Response.json({ error: "Deck not found" }, { status: 404 });
    }

    const { swaps } = (await request.json()) as FillDeckBody;
    if (!Array.isArray(swaps) || swaps.length === 0) {
      return Response.json({ error: "swaps must be a non-empty array" }, { status: 400 });
    }

    const malformed = swaps.filter(
      (s) => !Types.ObjectId.isValid(s?.ephemeralId) || !Types.ObjectId.isValid(s?.physicalCardId)
    );
    if (malformed.length > 0) {
      return Response.json({ error: "Invalid swaps", invalid: malformed }, { status: 400 });
    }

    const ephemeralIds = swaps.map((s) => s.ephemeralId);
    const physicalCardIds = swaps.map((s) => s.physicalCardId);
    if (
      new Set(ephemeralIds).size !== ephemeralIds.length ||
      new Set(physicalCardIds).size !== physicalCardIds.length
    ) {
      return Response.json({ error: "Duplicate ids in swaps" }, { status: 400 });
    }

    // Every ephemeralId must be one of this deck's ephemeral cards, and every
    // physicalCardId an owned collection-backed card.
    const [foundEphemerals, foundReals] = await Promise.all([
      PhysicalCardModel.find(
        { _id: { $in: ephemeralIds }, owner: userId, deckId: id, collectionId: null },
        { _id: 1 }
      ).lean(),
      PhysicalCardModel.find(
        { _id: { $in: physicalCardIds }, owner: userId, collectionId: { $ne: null } },
        { _id: 1 }
      ).lean()
    ]);
    const foundIds = new Set([...foundEphemerals, ...foundReals].map((c) => String(c._id)));
    const invalid = [...ephemeralIds, ...physicalCardIds].filter((cid) => !foundIds.has(cid));
    if (invalid.length > 0) {
      return Response.json({ error: "Invalid swaps", invalid }, { status: 400 });
    }

    // (1) Clean slate: pull the real cards from every deck arrangement (their
    // prior deck, if any) before this deck's arrays are rewritten.
    await DeckModel.updateMany(
      { owner: userId },
      {
        $pull: {
          "sections.$[].columns.$[].cards": {
            $in: physicalCardIds.map((cid) => new Types.ObjectId(cid))
          }
        }
      }
    );

    // (2) Back-refs first: the real cards now belong to this deck.
    await PhysicalCardModel.updateMany(
      { _id: { $in: physicalCardIds }, owner: userId },
      { deckId: id }
    );

    // (3) The replaced ephemerals cease to exist.
    await PhysicalCardModel.deleteMany({ _id: { $in: ephemeralIds }, owner: userId });

    // (4) Swap each ephemeral id for its real card in place. Reload the deck —
    // step (1) touched its arrays.
    const replacement = new Map(swaps.map((s) => [s.ephemeralId, s.physicalCardId]));
    const freshDeck = await DeckModel.findOne({ _id: id, owner: userId });
    freshDeck!.sections.forEach((s: any) =>
      s.columns.forEach((col: any) => {
        col.cards = col.cards.map((cid: any) => {
          const realId = replacement.get(String(cid));
          return realId ? new Types.ObjectId(realId) : cid;
        });
      })
    );
    freshDeck!.markModified("sections");
    await freshDeck!.save();

    return Response.json({ ok: true, filled: swaps.length });
  } catch (error) {
    console.error("Error filling deck:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

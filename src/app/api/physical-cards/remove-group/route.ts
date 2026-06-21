import connectDB from "@/db/mongoose";
import { PhysicalCardModel, DeckModel } from "@/db/schema";
import { Types } from "mongoose";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

interface RemoveGroupBody {
  collectionId: string;
  cardId: string;
  notes?: string;
  tags?: string[];
  /** null means the loose (no-deck) group; a value targets that deck's group. */
  deckId?: string | null;
  quantity: number;
}

function notesTagsMatch(
  card: { notes?: string; tags?: string[] },
  notes?: string,
  tags?: string[]
): boolean {
  if ((card.notes || "") !== (notes || "")) return false;
  const a = (card.tags || []).slice().sort();
  const b = (tags || []).slice().sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * POST /api/physical-cards/remove-group
 * Deletes `quantity` physical cards matching a collection-table group exactly
 * (same collection, cardId, notes, tags, and deck membership), pulling any of
 * them out of their deck arrangement.
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { collectionId, cardId, notes, tags, deckId, quantity } =
      (await request.json()) as RemoveGroupBody;

    if (!collectionId || !cardId || !quantity || quantity < 1) {
      return Response.json(
        { error: "collectionId, cardId and a positive quantity are required" },
        { status: 400 }
      );
    }

    const candidates = await PhysicalCardModel.find({
      owner: userId,
      collectionId,
      cardId,
      deckId: deckId ?? null
    }).lean();

    const matching = candidates.filter((c) => notesTagsMatch(c, notes, tags));
    const toDelete = matching.slice(0, quantity).map((c) => c._id);

    if (toDelete.length === 0) {
      return Response.json({ deleted: 0 });
    }

    if (deckId) {
      await DeckModel.updateOne(
        { _id: deckId, owner: userId },
        {
          $pull: {
            "sections.$[].columns.$[].cards": {
              $in: toDelete.map((id) => new Types.ObjectId(String(id)))
            }
          }
        }
      );
    }

    await PhysicalCardModel.deleteMany({ _id: { $in: toDelete }, owner: userId });

    return Response.json({ deleted: toDelete.length });
  } catch (error) {
    console.error("Error removing card group:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

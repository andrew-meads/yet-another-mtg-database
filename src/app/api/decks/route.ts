import connectDB from "@/db/mongoose";
import { DeckModel, PhysicalCardModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

/**
 * GET /api/decks
 * Lightweight list of the authenticated user's decks.
 *
 * @returns { decks: [{ _id, name, description, kind: "deck", isActive, owner, cardCount }] }
 */
export async function GET(_request: NextRequest) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const decks = await DeckModel.find(
      { owner: userId },
      { _id: 1, name: 1, description: 1, isActive: 1, owner: 1 }
    )
      .sort({ updatedAt: -1 })
      .lean();

    // Card totals come from the PhysicalCard deckId back-refs (the source of
    // truth for membership), not the deck's ordered arrays.
    const counts = await PhysicalCardModel.aggregate<{ _id: unknown; count: number }>([
      { $match: { deckId: { $in: decks.map((d) => d._id) } } },
      { $group: { _id: "$deckId", count: { $sum: 1 } } }
    ]);
    const countByDeckId = new Map(counts.map((c) => [String(c._id), c.count]));

    return Response.json({
      decks: decks.map((d) => ({
        ...d,
        kind: "deck" as const,
        cardCount: countByDeckId.get(String(d._id)) ?? 0
      }))
    });
  } catch (error) {
    console.error("Error fetching deck summaries:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/decks
 * Creates a new deck seeded with one empty "Main" section/column.
 *
 * Request Body:
 * - name: Deck name (required)
 * - description: Deck description (optional)
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const { name, description } = await request.json();
    if (!name) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }

    const deck = await DeckModel.create({
      name,
      description: description ?? "",
      owner: userId,
      sections: [{ name: "Main", columns: [{ cards: [] }] }]
    });

    return Response.json(
      { deck: { ...deck.toObject(), kind: "deck" } },
      { status: 201, headers: { Location: `/api/decks/${deck._id}` } }
    );
  } catch (error) {
    console.error("Error creating deck:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

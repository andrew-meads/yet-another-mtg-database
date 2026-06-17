import connectDB from "@/db/mongoose";
import { DeckModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

/**
 * GET /api/decks
 * Lightweight list of the authenticated user's decks.
 *
 * @returns { decks: [{ _id, name, kind: "deck", owner }] }
 */
export async function GET(_request: NextRequest) {
  try {
    await connectDB();

    const session = await getServerSession(authOptions);
    const userId = session!.user._id;

    const decks = await DeckModel.find({ owner: userId }, { _id: 1, name: 1, owner: 1 })
      .sort({ updatedAt: -1 })
      .lean();

    return Response.json({ decks: decks.map((d) => ({ ...d, kind: "deck" as const })) });
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

    const session = await getServerSession(authOptions);
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

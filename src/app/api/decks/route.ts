import connectDB from "@/db/mongoose";
import { DeckModel, PhysicalCardModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { getAuthSession } from "@/auth";
import { effectiveSectionKind } from "@/lib/deckUtils";

/**
 * GET /api/decks
 * Lightweight list of the authenticated user's decks.
 *
 * @returns { decks: [{ _id, name, description, kind: "deck", isActive, owner, cardCount, sideboardCount }] }
 *
 * `cardCount` is the main deck: every copy whose deckId points at the deck
 * except those placed in a sideboard or scratch-area section. Sideboard copies
 * are counted in `sideboardCount`; scratch-area copies aren't counted at all.
 */
export async function GET(_request: NextRequest) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const decks = await DeckModel.find(
      { owner: userId },
      { _id: 1, name: 1, description: 1, isActive: 1, owner: 1, sections: 1 }
    )
      .sort({ updatedAt: -1 })
      .lean();

    // Copies placed in sideboard / scratch sections, by the arrangement arrays.
    const sideboardIds: Types.ObjectId[] = [];
    const scratchIds: Types.ObjectId[] = [];
    for (const deck of decks) {
      for (const section of deck.sections ?? []) {
        const kind = effectiveSectionKind(section.kind);
        if (kind === "normal") continue;
        const ids = section.columns.flatMap((column) => column.cards);
        (kind === "sideboard" ? sideboardIds : scratchIds).push(...ids);
      }
    }

    // Card totals come from the PhysicalCard deckId back-refs (the source of
    // truth for membership), not the deck's ordered arrays; the arrays only
    // decide which bucket a copy counts toward (unplaced copies count as main).
    const counts = await PhysicalCardModel.aggregate<{
      _id: unknown;
      main: number;
      sideboard: number;
    }>([
      { $match: { deckId: { $in: decks.map((d) => d._id) }, _id: { $nin: scratchIds } } },
      {
        $group: {
          _id: "$deckId",
          main: { $sum: { $cond: [{ $in: ["$_id", sideboardIds] }, 0, 1] } },
          sideboard: { $sum: { $cond: [{ $in: ["$_id", sideboardIds] }, 1, 0] } }
        }
      }
    ]);
    const countByDeckId = new Map(counts.map((c) => [String(c._id), c]));

    return Response.json({
      decks: decks.map(({ sections: _sections, ...d }) => ({
        ...d,
        kind: "deck" as const,
        cardCount: countByDeckId.get(String(d._id))?.main ?? 0,
        sideboardCount: countByDeckId.get(String(d._id))?.sideboard ?? 0
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

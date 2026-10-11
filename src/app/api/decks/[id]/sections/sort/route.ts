import connectDB from "@/db/mongoose";
import { Types } from "mongoose";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";
import { sectionSortSchema, sortDeckSection } from "@/lib/server/deckSectionSort";

/**
 * POST /api/decks/[id]/sections/sort
 * Rebuilds one section's columns by mana value or color, optionally sorting inside each
 * column by the other key. Body: { sectionId, mode }. One-shot: nothing about the mode is
 * stored, and column ids are regenerated.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/decks/[id]/sections/sort">
) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;
    const { id } = await ctx.params;

    const parsed = sectionSortSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: `Invalid request: ${parsed.error.issues[0]?.message ?? "bad request"}` },
        { status: 400 }
      );
    }
    const { sectionId, mode } = parsed.data;

    // A malformed id can't be anyone's deck — 404 rather than a CastError 500.
    const result = Types.ObjectId.isValid(id)
      ? await sortDeckSection(userId, id, sectionId, mode)
      : "deck-not-found";
    if (result === "deck-not-found") {
      return Response.json({ error: "Deck not found" }, { status: 404 });
    }
    if (result === "section-not-found") {
      return Response.json({ error: "Section not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error sorting section:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

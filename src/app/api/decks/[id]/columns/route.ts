import connectDB from "@/db/mongoose";
import { DeckModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadDeck(id: string, userId: string) {
  return DeckModel.findOne({ _id: id, owner: userId });
}

/**
 * POST /api/decks/[id]/columns
 * Adds a new (empty) column to a section. Body: { sectionId }.
 * Returns the new column id.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/decks/[id]/columns">) {
  try {
    await connectDB();
    const session = await getServerSession(authOptions);
    const userId = session!.user._id;
    const { id } = await ctx.params;
    const { sectionId } = await request.json();

    const deck = await loadDeck(id, userId);
    if (!deck) return Response.json({ error: "Deck not found" }, { status: 404 });

    const section = deck.sections.find((s: any) => String(s._id) === sectionId) as any;
    if (!section) return Response.json({ error: "Section not found" }, { status: 404 });

    section.columns.push({ cards: [] });
    await deck.save();
    const column = section.columns[section.columns.length - 1];

    return Response.json({ columnId: String(column._id) }, { status: 201 });
  } catch (error) {
    console.error("Error adding column:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/decks/[id]/columns
 * Reorders columns within a section. Body: { sectionId, order: columnId[] }.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/decks/[id]/columns">) {
  try {
    await connectDB();
    const session = await getServerSession(authOptions);
    const userId = session!.user._id;
    const { id } = await ctx.params;
    const { sectionId, order } = await request.json();

    const deck = await loadDeck(id, userId);
    if (!deck) return Response.json({ error: "Deck not found" }, { status: 404 });

    const section = deck.sections.find((s: any) => String(s._id) === sectionId) as any;
    if (!section) return Response.json({ error: "Section not found" }, { status: 404 });
    if (!Array.isArray(order)) {
      return Response.json({ error: "order array is required" }, { status: 400 });
    }

    section.columns.sort(
      (a: any, b: any) => order.indexOf(String(a._id)) - order.indexOf(String(b._id))
    );
    deck.markModified("sections");
    await deck.save();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error reordering columns:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/decks/[id]/columns
 * Deletes an empty column. Body: { sectionId, columnId }. Refuses if non-empty.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/decks/[id]/columns">) {
  try {
    await connectDB();
    const session = await getServerSession(authOptions);
    const userId = session!.user._id;
    const { id } = await ctx.params;
    const { sectionId, columnId } = await request.json();

    const deck = await loadDeck(id, userId);
    if (!deck) return Response.json({ error: "Deck not found" }, { status: 404 });

    const section = deck.sections.find((s: any) => String(s._id) === sectionId) as any;
    if (!section) return Response.json({ error: "Section not found" }, { status: 404 });

    const column = section.columns.find((c: any) => String(c._id) === columnId);
    if (!column) return Response.json({ error: "Column not found" }, { status: 404 });
    if (column.cards.length > 0) {
      return Response.json({ error: "Column is not empty" }, { status: 409 });
    }

    section.columns = section.columns.filter((c: any) => String(c._id) !== columnId);
    deck.markModified("sections");
    await deck.save();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error deleting column:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

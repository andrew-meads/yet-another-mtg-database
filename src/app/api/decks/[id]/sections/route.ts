import connectDB from "@/db/mongoose";
import { DeckModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadDeck(id: string, userId: string) {
  return DeckModel.findOne({ _id: id, owner: userId });
}

/**
 * POST /api/decks/[id]/sections
 * Adds a new (empty) section. Body: { name }. Returns the new section id.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/decks/[id]/sections">) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;
    const { id } = await ctx.params;
    const { name } = await request.json();

    const deck = await loadDeck(id, userId);
    if (!deck) return Response.json({ error: "Deck not found" }, { status: 404 });

    deck.sections.push({ name: name || "New Section", columns: [{ cards: [] }] } as any);
    await deck.save();
    const section = deck.sections[deck.sections.length - 1] as any;

    return Response.json({ sectionId: String(section._id) }, { status: 201 });
  } catch (error) {
    console.error("Error adding section:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/decks/[id]/sections
 * Renames a section ({ sectionId, name }) or reorders sections ({ order: id[] }).
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/decks/[id]/sections">) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;
    const { id } = await ctx.params;
    const { sectionId, name, order } = await request.json();

    const deck = await loadDeck(id, userId);
    if (!deck) return Response.json({ error: "Deck not found" }, { status: 404 });

    if (Array.isArray(order)) {
      deck.sections.sort(
        (a: any, b: any) => order.indexOf(String(a._id)) - order.indexOf(String(b._id))
      );
      deck.markModified("sections");
    } else if (sectionId && typeof name === "string") {
      const section = deck.sections.find((s: any) => String(s._id) === sectionId) as any;
      if (!section) return Response.json({ error: "Section not found" }, { status: 404 });
      section.name = name;
    } else {
      return Response.json({ error: "Provide { sectionId, name } or { order }" }, { status: 400 });
    }

    await deck.save();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error updating section:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/decks/[id]/sections
 * Deletes an empty section. Body: { sectionId }. Refuses if it still holds cards.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/decks/[id]/sections">) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;
    const { id } = await ctx.params;
    const { sectionId } = await request.json();

    const deck = await loadDeck(id, userId);
    if (!deck) return Response.json({ error: "Deck not found" }, { status: 404 });

    const section = deck.sections.find((s: any) => String(s._id) === sectionId) as any;
    if (!section) return Response.json({ error: "Section not found" }, { status: 404 });

    const cardCount = section.columns.reduce((sum: number, c: any) => sum + c.cards.length, 0);
    if (cardCount > 0) {
      return Response.json({ error: "Section is not empty" }, { status: 409 });
    }

    deck.sections = deck.sections.filter((s: any) => String(s._id) !== sectionId) as any;
    await deck.save();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error deleting section:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

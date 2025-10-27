import connectDB from "@/db/mongoose";
import { Card } from "@/db/schema";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/cards/[id]">) {
  try {
    // Connect to database
    await connectDB();

    const { id } = await ctx.params;
    const searchParams = request.nextUrl.searchParams;
    const shouldFetch = searchParams.get("fetch") === "true";

    // Fetch from Scryfall and update DB if requested
    if (shouldFetch) {
      const url = `${process.env.SCRYFALL_API_BASE_URL!}/cards/${id}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error("Error fetching from Scryfall:", response.statusText);
        return Response.json({ error: "Failed to fetch card from Scryfall" }, { status: 502 });
      }
      const cardData = await response.json();
      await Card.deleteOne({ id }); // Remove existing card if any
      const newCard = new Card(cardData);
      await newCard.save();
      return Response.json(newCard);
    }

    // Load card from db and return it, or a 404 if not found.
    const card = await Card.findOne({ id });
    if (!card) return Response.json({ error: "Card not found" }, { status: 404 });
    return Response.json(card);
  } catch (error) {
    console.error("Error fetching card:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

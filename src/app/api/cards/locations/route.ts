import connectDB from "@/db/mongoose";
import { CardData, PhysicalCardModel } from "@/db/schema";
import { CardLocation } from "@/types/CardLocation";
import { detailPhysicalCards } from "@/lib/server/cardDetails";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

/**
 * GET /api/cards/locations?name=CardName
 * Finds all of the user's collections that contain physical cards with the given
 * (exact, case-sensitive) name, grouped by collection.
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const cardName = request.nextUrl.searchParams.get("name");
    if (!cardName) {
      return Response.json({ locations: [] });
    }

    const matchingCards = await CardData.find({ name: cardName }, { id: 1 }).lean();
    if (matchingCards.length === 0) {
      return Response.json({ locations: [] });
    }
    const matchingCardIds = matchingCards.map((card) => card.id);

    const session = await getAuthSession();
    const userId = session!.user._id;

    const physicalCards = await PhysicalCardModel.find({
      cardId: { $in: matchingCardIds },
      owner: userId
    }).lean();

    const detailed = await detailPhysicalCards(physicalCards);

    // Group by collection. Ephemeral (deck-only) cards have no collection, so
    // they don't appear in this collection-location view.
    const byCollection = new Map<string, CardLocation>();
    for (const card of detailed) {
      const key = card.collectionId;
      if (!key) continue;
      if (!byCollection.has(key)) {
        byCollection.set(key, {
          collectionId: key,
          collectionName: card.collectionName ?? "",
          cards: []
        });
      }
      byCollection.get(key)!.cards.push(card);
    }

    return Response.json({ locations: [...byCollection.values()] });
  } catch (error) {
    console.error("Error finding card locations:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

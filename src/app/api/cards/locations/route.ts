import connectDB from "@/db/mongoose";
import { CardCollectionModel, Card } from "@/db/schema";
import { CardLocation } from "@/types/CardLocation";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

/**
 * GET /api/cards/locations?name=CardName
 * Finds all collections containing cards with the specified name.
 *
 * Query Parameters:
 * - name: Card name to search for (required)
 *
 * @returns Array of CardLocation objects, each containing:
 *   - collectionId: The collection's ID
 *   - collectionName: The collection's name
 *   - cards: Array of DetailedCardEntry objects for matching cards
 *
 * The search matches exact card names (case-sensitive).
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const searchParams = request.nextUrl.searchParams;
    const cardName = searchParams.get("name");

    if (!cardName) {
      return Response.json({ locations: [] });
    }

    // Find all cards matching the name (exact match, case-sensitive)
    const matchingCards = await Card.find({
      name: cardName
    }).lean();

    if (matchingCards.length === 0) {
      return Response.json({ locations: [] });
    }

    // Get all matching card IDs
    const matchingCardIds = matchingCards.map((card) => card.id);

    const session = await getServerSession(authOptions);
    const userId = session!.user._id;

    // Find all collections that contain at least one of these cards and are owned by the current user
    const collections = await CardCollectionModel.find({
      "cards.cardId": { $in: matchingCardIds },
      owner: userId
    }).lean();

    // Build CardLocation objects
    const locations: CardLocation[] = collections.map((collection) => {
      // Filter to only include matching card entries
      const matchingEntries = collection.cards.filter((entry) =>
        matchingCardIds.includes(entry.cardId)
      );

      // Populate card details for each matching entry
      const cardsDetailed = matchingEntries.map((entry) => {
        const cardDetail = matchingCards.find((mc) => mc.id === entry.cardId);
        return {
          _id: entry._id!,
          card: cardDetail!,
          quantity: entry.quantity,
          notes: entry.notes,
          tags: entry.tags
        };
      });

      return {
        collectionId: collection._id.toString(),
        collectionName: collection.name,
        cards: cardsDetailed
      };
    });

    return Response.json({ locations });
  } catch (error) {
    console.error("Error finding card locations:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

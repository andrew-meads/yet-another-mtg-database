import connectDB from "@/db/mongoose";
import { getCardPriceQuotes, toPriceQuotesResponse } from "@/lib/server/cardPrices";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";
import { userPriceSourceOrder } from "@/lib/server/priceSourceOrder";

/** Upper bound on ids per request, to cap the number of Scryfall batches. */
const MAX_IDS = 500;

/**
 * POST /api/cards/prices
 * Body: { ids: string[] } — Scryfall card ids.
 *
 * Returns up-to-date prices for each requested card plus when each was written
 * (so the client can show how old a price is):
 *   {
 *     prices:    { [cardId]: { usd, usd_foil, usd_etched, eur, eur_foil, tix } },
 *     updatedAt: { [cardId]: ISO string | null }
 *   }
 *
 * Prices live on the card documents; those stamped within 24h are served as-is
 * and the rest are refreshed through the user's price sources in priority order
 * (see src/lib/server/priceSources). One endpoint serves a single card or a list.
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    const ids = (body as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return Response.json({ error: "`ids` must be an array of strings" }, { status: 400 });
    }
    if (ids.length === 0) {
      return Response.json({ error: "`ids` must not be empty" }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
      return Response.json({ error: `ids must not exceed ${MAX_IDS} entries` }, { status: 400 });
    }

    const session = await getAuthSession();
    const sources = await userPriceSourceOrder(session!.user._id);
    const quotes = await getCardPriceQuotes(ids as string[], { sources });
    return Response.json(toPriceQuotesResponse(quotes));
  } catch (error) {
    console.error("Error fetching card prices:", error);
    return Response.json(
      { error: "Failed to fetch prices from any price source" },
      { status: 502 }
    );
  }
}

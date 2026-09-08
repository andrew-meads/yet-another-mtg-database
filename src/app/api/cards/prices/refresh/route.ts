import connectDB from "@/db/mongoose";
import { refreshCardPriceQuotes, toPriceQuotesResponse } from "@/lib/server/cardPrices";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";
import { userPriceSourceOrder } from "@/lib/server/priceSourceOrder";

/** A manual refresh is per card (or a handful); keep the Scryfall cost bounded. */
const MAX_IDS = 100;

/**
 * POST /api/cards/prices/refresh
 * Body: { ids: string[] } — Scryfall card ids.
 *
 * Force-refreshes the prices of the given cards right now, ignoring the 24h
 * freshness window (the user's explicit "refresh price" action), trying the
 * user's enabled price sources in priority order until one yields a price, and
 * returns the same `{ prices, updatedAt }` shape as POST /api/cards/prices.
 * 400 on bad input, 502 when every source fails.
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
    const quotes = await refreshCardPriceQuotes(ids as string[], { sources });
    return Response.json(toPriceQuotesResponse(quotes));
  } catch (error) {
    console.error("Error refreshing card prices:", error);
    return Response.json(
      { error: "Failed to refresh prices from any price source" },
      { status: 502 }
    );
  }
}

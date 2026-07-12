import connectDB from "@/db/mongoose";
import { getCardPrices } from "@/lib/server/cardPrices";
import { NextRequest } from "next/server";

/** Upper bound on ids per request, to cap the number of Scryfall batches. */
const MAX_IDS = 500;

/**
 * POST /api/cards/prices
 * Body: { ids: string[] } — Scryfall card ids.
 *
 * Returns up-to-date prices for each requested card:
 *   { prices: { [cardId]: { usd, usd_foil, usd_etched, eur, eur_foil, tix } } }
 *
 * Prices are served from a 24h cache and refreshed from Scryfall's
 * /cards/collection endpoint (batched at 75) only when stale/missing. One
 * endpoint serves a single card or a list.
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

    const prices = await getCardPrices(ids as string[]);
    return Response.json({ prices });
  } catch (error) {
    console.error("Error fetching card prices:", error);
    return Response.json({ error: "Failed to fetch prices from Scryfall" }, { status: 502 });
  }
}

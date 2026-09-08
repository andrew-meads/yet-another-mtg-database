import connectDB from "@/db/mongoose";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";
import { userPriceSourceOrder } from "@/lib/server/priceSourceOrder";
import { MAX_COPY_REFRESH, refreshCopyPrices } from "@/lib/server/copyPrices";

/**
 * POST /api/physical-cards/prices/refresh
 * Body: { physicalCardIds: string[] } — the user's physical cards (≤ 100).
 *
 * Fetches a price for each copy according to ITS finish and condition, through
 * the user's price sources in priority order (a source that priced the exact
 * condition tier is preferred; otherwise the finish-level price is used and
 * flagged), and stores it on the copy. Copies tagged "Proxy" are never priced
 * (worth $0 by rule) and are listed in `proxies`. Returns
 *   { prices: { [physicalCardId]: CopyPrice }, unknown: string[], proxies: string[] }
 * — `unknown` lists ids that aren't the user's. 400 on bad input, 502 when
 * every source fails.
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    const ids = (body as { physicalCardIds?: unknown })?.physicalCardIds;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return Response.json(
        { error: "`physicalCardIds` must be an array of strings" },
        { status: 400 }
      );
    }
    if (ids.length === 0) {
      return Response.json({ error: "`physicalCardIds` must not be empty" }, { status: 400 });
    }
    if (ids.length > MAX_COPY_REFRESH) {
      return Response.json(
        { error: `physicalCardIds must not exceed ${MAX_COPY_REFRESH} entries` },
        { status: 400 }
      );
    }

    const sources = await userPriceSourceOrder(userId);
    const result = await refreshCopyPrices(userId, ids as string[], sources);
    return Response.json(result);
  } catch (error) {
    console.error("Error refreshing copy prices:", error);
    return Response.json(
      { error: "Failed to refresh prices from any price source" },
      { status: 502 }
    );
  }
}

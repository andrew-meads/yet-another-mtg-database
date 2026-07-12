import connectDB from "@/db/mongoose";
import { getExchangeRate, isValidCurrencyCode } from "@/lib/server/exchangeRate";
import { NextRequest } from "next/server";

/**
 * GET /api/exchange-rate?target=NZD
 *
 * Returns the USD -> target rate: { base, target, rate, updatedAt }. Cached for
 * 24h and refreshed from Frankfurter (free, no API key). `target=USD` yields
 * rate 1. Returns 400 for a malformed currency code and 502 if the upstream
 * rate service is unreachable or doesn't know the currency.
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const target = request.nextUrl.searchParams.get("target")?.toUpperCase();
    if (!target || !isValidCurrencyCode(target)) {
      return Response.json(
        { error: "`target` must be a 3-letter ISO 4217 currency code" },
        { status: 400 }
      );
    }

    const rate = await getExchangeRate(target);
    return Response.json(rate);
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    return Response.json({ error: "Failed to fetch exchange rate" }, { status: 502 });
  }
}

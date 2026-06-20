import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import connectDB from "@/db/mongoose";
import { CardData } from "@/db/schema";
import { MtgCard } from "@/types/MtgCard";
import { RawScanResponse, ScanResponse } from "@/types/ScanResult";

const SCANNER_BASE_URL = process.env.SCANNER_BASE_URL || "http://localhost:8000";

/**
 * POST /api/scan
 *
 * Auth-guarded proxy to the external card-scanner backend. Forwards the uploaded
 * card photo (multipart "image" field) to `${SCANNER_BASE_URL}/api/scan`, which
 * de-skews each card and returns ranked Scryfall matches.
 *
 * Unlike most of the scan plumbing this route is NOT a pure pass-through: on a 200
 * response it trusts only each match's `scryfallId` and re-hydrates the matches from
 * our local `cards` collection (one batch lookup), so the client renders the same
 * `MtgCard` data as the rest of the app. Non-200 responses are forwarded verbatim.
 *
 * Request body:
 * - FormData with an "image" field containing the card image as a Blob
 *
 * Response:
 * - 200 OK with the enriched JSON (crops + matches hydrated from local card data)
 * - 400 Bad Request if the image is missing or invalid
 * - 401 Unauthorized if there is no session (also enforced by src/proxy.ts)
 * - 502 Bad Gateway if the card scanner is unreachable
 */
export async function POST(request: NextRequest) {
  // Auth check (the proxy middleware also guards /api/* routes).
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Extract and validate the uploaded image.
  const formData = await request.formData();
  const image = formData.get("image");
  if (!(image instanceof Blob)) {
    return Response.json({ error: "No image provided or invalid image format" }, { status: 400 });
  }

  // Forward to the card-scanner backend, rebuilding the multipart form so fetch
  // sets a fresh boundary.
  let res: Response;
  try {
    const upstream = new FormData();
    upstream.append("image", image);

    res = await fetch(`${SCANNER_BASE_URL}/api/scan`, {
      method: "POST",
      body: upstream
    });
  } catch (error) {
    console.error("Error proxying to card scanner:", error);
    return Response.json({ error: "Card scanner unavailable" }, { status: 502 });
  }

  // For non-success responses, pass the scanner's body and status straight through.
  if (!res.ok) {
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" }
    });
  }

  // Enrich the matches from our local card data, keyed by scryfallId.
  const raw = (await res.json()) as RawScanResponse;
  const enriched = await enrichScanResponse(raw);
  return Response.json(enriched);
}

/**
 * Replace each raw match with the corresponding local `MtgCard` (by `scryfallId`),
 * preserving the scanner's best-first order. Matches whose id is absent from the local
 * `cards` collection are dropped; a card left with no matches simply renders its empty
 * state on the results page.
 */
async function enrichScanResponse(raw: RawScanResponse): Promise<ScanResponse> {
  const ids = [
    ...new Set(raw.cards.flatMap((card) => card.matches.map((match) => match.scryfallId)))
  ];

  const cardMap = new Map<string, MtgCard>();
  if (ids.length > 0) {
    await connectDB();
    const cards = await CardData.find({ id: { $in: ids } }).lean<MtgCard[]>();
    for (const card of cards) cardMap.set(card.id, card);
  }

  return {
    count: raw.count,
    debugUrl: raw.debugUrl,
    cards: raw.cards.map((card) => ({
      id: card.id,
      url: card.url,
      width: card.width,
      height: card.height,
      matches: card.matches
        .map((match) => cardMap.get(match.scryfallId))
        .filter((card): card is MtgCard => card !== undefined)
    }))
  };
}

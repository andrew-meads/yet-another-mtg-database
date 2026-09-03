import connectDB from "@/db/mongoose";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";
import { loadDeckWithCards } from "@/lib/server/deckLoad";
import { renderDeckExport } from "@/lib/server/deckExport";
import { buildDeckExportModel, parseDeckExportOptions } from "@/lib/deckExport";
import { joinDeckEntries } from "@/lib/cardEntries";

/**
 * GET /api/decks/[id]/export?format=txt|xlsx|pdf&byPrinting=true&ownership=true&images=true
 *
 * Renders the deck as a downloadable decklist. Rows are aggregated per section
 * in column-then-section order (see buildDeckExportModel):
 *  - `byPrinting`  groups by exact printing instead of card name
 *  - `ownership`   appends owned/placeholder counts to every row
 *  - `images`      (PDF only) renders a card image per row, fetched from Scryfall
 *
 * Responds with the file bytes and a `Content-Disposition: attachment` header.
 * 400 on a bad/missing format, 404 when the deck isn't the user's.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/decks/[id]/export">) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const options = parseDeckExportOptions(request.nextUrl.searchParams);
    if (!options) {
      return Response.json(
        { error: "Invalid export format; expected format=txt, xlsx, or pdf" },
        { status: 400 }
      );
    }

    const { id } = await ctx.params;
    const loaded = await loadDeckWithCards(id, userId);
    if (!loaded) {
      return Response.json({ error: "Deck not found" }, { status: 404 });
    }

    const deck = joinDeckEntries(loaded.deck, loaded.cardData);
    const model = buildDeckExportModel(deck, options);
    const { body, contentType, fileName } = await renderDeckExport(model);

    // ASCII fallback for old clients plus the RFC 5987 UTF-8 form.
    const asciiName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return new Response(body as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("Error exporting deck:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

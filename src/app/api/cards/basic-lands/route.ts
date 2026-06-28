import connectDB from "@/db/mongoose";
import { getBasicLands } from "@/lib/server/basicLands";

/**
 * GET /api/cards/basic-lands
 * Returns the five basic lands (one printing each, WUBRG order) used to add
 * ephemeral lands to a deck. Auth is enforced by src/proxy.ts for /api/*.
 */
export async function GET() {
  try {
    await connectDB();
    const cards = await getBasicLands();
    return Response.json(
      { cards },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } }
    );
  } catch (error) {
    console.error("Error fetching basic lands:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

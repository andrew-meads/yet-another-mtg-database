import { NextRequest } from "next/server";
import connectDB from "@/db/mongoose";
import { getAuthSession } from "@/auth";
import { getAiConfig } from "@/lib/server/userSettings";

/**
 * GET /api/ai/status — whether the user has a complete AI configuration.
 * Every AI entry point in the UI gates on this; server routes still enforce it
 * independently (409 ai_not_configured) so a stale client cannot bypass it.
 */
export async function GET(_request: NextRequest) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;

    const config = await getAiConfig(userId);
    if (!config) {
      return Response.json({ configured: false });
    }

    let baseUrlHost: string | undefined;
    try {
      baseUrlHost = new URL(config.baseUrl).host;
    } catch {
      baseUrlHost = undefined;
    }

    return Response.json({ configured: true, model: config.model, baseUrlHost });
  } catch (error) {
    console.error("Error fetching AI status:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

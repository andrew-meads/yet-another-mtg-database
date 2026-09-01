import { NextRequest } from "next/server";
import connectDB from "@/db/mongoose";
import { getAuthSession } from "@/auth";
import { aiSettingsPutSchema, putAiSettings, toClientSettings } from "@/lib/server/userSettings";

/**
 * PUT /api/settings/ai — update the user's OpenAI-compatible endpoint settings.
 * Separate from PATCH /api/settings because of the API-key semantics: `apiKey`
 * omitted keeps the stored key, `""` clears it, any other value replaces it.
 * The key is sealed at rest and never echoed back (only `hasApiKey` + a hint).
 */
export async function PUT(request: NextRequest) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;

    const parsed = aiSettingsPutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        {
          error: `Invalid AI settings payload: ${parsed.error.issues[0]?.message ?? "bad request"}`
        },
        { status: 400 }
      );
    }

    const doc = await putAiSettings(userId, parsed.data);
    return Response.json({ settings: toClientSettings(doc) });
  } catch (error) {
    console.error("Error updating AI settings:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

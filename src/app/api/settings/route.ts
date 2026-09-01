import { NextRequest } from "next/server";
import connectDB from "@/db/mongoose";
import { getAuthSession } from "@/auth";
import {
  getUserSettingsDoc,
  patchUserSettings,
  settingsPatchSchema,
  toClientSettings
} from "@/lib/server/userSettings";

/** GET /api/settings — all of the user's settings sections (AI key masked). */
export async function GET(_request: NextRequest) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;

    const doc = await getUserSettingsDoc(userId);
    return Response.json({ settings: toClientSettings(doc) });
  } catch (error) {
    console.error("Error fetching user settings:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/settings — partial update of the non-secret sections
 * (`cardPreview`, `openEntities`). Only the provided sections are written.
 */
export async function PATCH(request: NextRequest) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;

    const parsed = settingsPatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: `Invalid settings payload: ${parsed.error.issues[0]?.message ?? "bad request"}` },
        { status: 400 }
      );
    }

    const doc = await patchUserSettings(userId, parsed.data);
    return Response.json({ settings: toClientSettings(doc) });
  } catch (error) {
    console.error("Error updating user settings:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

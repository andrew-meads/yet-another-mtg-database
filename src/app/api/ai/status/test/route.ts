import { NextRequest } from "next/server";
import { generateText } from "ai";
import connectDB from "@/db/mongoose";
import { getAuthSession } from "@/auth";
import { AiNotConfiguredError, aiNotConfiguredResponse, getAiModel } from "@/lib/ai/provider";

/**
 * POST /api/ai/status/test — one tiny completion against the user's configured
 * endpoint to smoke-test the base URL / model / API key. Returns
 * `{ ok: true }` on success, `502 { ok: false, error }` on any upstream failure.
 */
export async function POST(_request: NextRequest) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;

    const { model } = await getAiModel(userId);

    try {
      await generateText({
        model,
        prompt: "Reply with the single word: OK",
        maxOutputTokens: 50,
        // Fail fast — this is an interactive smoke test, not a workload.
        maxRetries: 0
      });
      return Response.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed";
      return Response.json({ ok: false, error: message }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return aiNotConfiguredResponse();
    console.error("Error testing AI connection:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

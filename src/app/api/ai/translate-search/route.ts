import { NextRequest } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import connectDB from "@/db/mongoose";
import { getAuthSession } from "@/auth";
import { AiNotConfiguredError, aiNotConfiguredResponse, getAiModel } from "@/lib/ai/provider";
import {
  buildSearchTranslatorSystemPrompt,
  parseTranslateSearchResult
} from "@/lib/ai/agents/searchTranslator";
import { parseSearchQuery } from "@/lib/search/queryBuilder";

const bodySchema = z.strictObject({
  prompt: z.string().min(1).max(2000)
});

/**
 * POST /api/ai/translate-search — translate a natural-language card request
 * into the app's Scryfall-style query syntax via one LLM call. Returns
 * `{ query, notes? }`; the client inserts the (editable) query into the search
 * bar and runs it through the normal search pipeline.
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const session = await getAuthSession();
    const userId = session!.user._id;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: `Invalid request: ${parsed.error.issues[0]?.message ?? "bad request"}` },
        { status: 400 }
      );
    }

    const { model } = await getAiModel(userId);

    let text: string;
    let finishReason: string | undefined;
    try {
      const result = await generateText({
        model,
        system: buildSearchTranslatorSystemPrompt(),
        prompt: parsed.data.prompt,
        // Generous ceiling: reasoning models spend output tokens on thinking
        // before any visible text, and a starved budget yields an empty reply.
        maxOutputTokens: 2000,
        // One retry keeps the interactive flow snappy on flaky endpoints.
        maxRetries: 1
      });
      text = result.text;
      finishReason = result.finishReason;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed";
      return Response.json({ error: `AI request failed: ${message}` }, { status: 502 });
    }

    let translation;
    try {
      translation = parseTranslateSearchResult(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unparseable response";
      // Full reply to the server log; a trimmed copy in the response so the
      // client can show what the model actually said.
      console.error("translate-search: unusable AI response", { finishReason, text });
      return Response.json(
        {
          error: "The AI returned an unusable response.",
          detail,
          finishReason,
          raw: text.slice(0, 500)
        },
        { status: 502 }
      );
    }

    // Sanity-pass the query through the real parser. It degrades rather than
    // throws on unknown syntax, so this only guards against pathological output.
    try {
      parseSearchQuery(translation.query);
    } catch {
      console.error("translate-search: query failed to parse", { query: translation.query });
      return Response.json(
        {
          error: "The AI produced an invalid search query.",
          raw: translation.query
        },
        { status: 502 }
      );
    }

    return Response.json({ query: translation.query, notes: translation.notes });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return aiNotConfiguredResponse();
    console.error("Error translating search:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

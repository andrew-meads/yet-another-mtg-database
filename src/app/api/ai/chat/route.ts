import { NextRequest } from "next/server";
import { convertToModelMessages, stepCountIs, streamText, UIMessage } from "ai";
import { z } from "zod";
import connectDB from "@/db/mongoose";
import { getAuthSession } from "@/auth";
import { AiNotConfiguredError, aiNotConfiguredResponse, getAiModel } from "@/lib/ai/provider";
import { getAgentPersona } from "@/lib/ai/agents";
import { buildAiToolSubset } from "@/lib/ai/tools";

/** Tool loops can take a while; allow up to two minutes per turn. */
export const maxDuration = 120;

const bodySchema = z.object({
  // UIMessage is structurally rich; validate the envelope loosely and let
  // convertToModelMessages reject anything malformed (mapped to 400 below).
  messages: z
    .array(z.looseObject({ role: z.string(), parts: z.array(z.unknown()) }))
    .min(1)
    .max(200),
  agentId: z.string().min(1),
  context: z
    .object({
      deckId: z.string().optional(),
      collectionId: z.string().optional()
    })
    .optional()
});

/**
 * POST /api/ai/chat — the app's streaming chat endpoint. Body
 * `{ messages: UIMessage[], agentId, context: { deckId?, collectionId? } }`.
 * Runs the persona's read-only tool loop via streamText and streams UI-message
 * chunks back (@ai-sdk/react useChat's wire format). Conversation state is
 * client-held: the client resends the transcript each turn.
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

    const persona = getAgentPersona(parsed.data.agentId);
    if (!persona) {
      return Response.json({ error: `Unknown agent "${parsed.data.agentId}"` }, { status: 400 });
    }

    const { model } = await getAiModel(userId);

    let modelMessages;
    try {
      modelMessages = convertToModelMessages(parsed.data.messages as unknown as UIMessage[]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "malformed messages";
      return Response.json({ error: `Invalid messages: ${detail}` }, { status: 400 });
    }

    const result = streamText({
      model,
      system: persona.buildSystemPrompt(parsed.data.context ?? {}),
      messages: modelMessages,
      tools: buildAiToolSubset({ userId }, persona.toolNames),
      stopWhen: stepCountIs(persona.stepLimit),
      // Generous ceiling: reasoning models spend output tokens on thinking.
      maxOutputTokens: persona.maxOutputTokens,
      // One retry keeps the interactive flow snappy on flaky endpoints.
      maxRetries: 1,
      onError: ({ error }) => {
        console.error("ai/chat stream error:", error);
      }
    });

    return result.toUIMessageStreamResponse({
      headers: { "Cache-Control": "no-cache, no-transform" },
      // Surface real provider error text to the client (house convention:
      // diagnostics beat opaque "something went wrong" messages).
      onError: (error) => {
        const message = error instanceof Error ? error.message : "AI request failed";
        return message.slice(0, 500);
      }
    });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return aiNotConfiguredResponse();
    console.error("Error in AI chat:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

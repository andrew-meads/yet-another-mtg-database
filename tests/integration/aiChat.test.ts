import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { POST as chat } from "@/app/api/ai/chat/route";
import { PUT as putAiSettings } from "@/app/api/settings/ai/route";
import { jsonRequest, seedUser, seedCard, setTestUser } from "./helpers";
import "./setup";

/**
 * MSW impersonates the user's OpenAI-compatible endpoint with SSE streaming
 * responses, so the chat route exercises the real streamText tool loop:
 * request 1 answers with a searchCards tool call, request 2 (carrying the tool
 * result) answers with final text.
 */
const AI_BASE = "http://ai.test/v1";

const mswServer = setupServer();

beforeAll(() => mswServer.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

beforeEach(async () => {
  const userId = await seedUser();
  setTestUser(userId);
});

async function configureAi() {
  await putAiSettings(
    jsonRequest("/api/settings/ai", "PUT", {
      baseUrl: AI_BASE,
      model: "test-model",
      apiKey: "sk-test"
    })
  );
}

const CHUNK_BASE = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "test-model" };

function sseResponse(chunks: unknown[]) {
  const body =
    chunks.map((c) => `data: ${JSON.stringify(c)}`).join("\n\n") + "\n\ndata: [DONE]\n\n";
  return new HttpResponse(body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
  });
}

function textChunks(text: string) {
  return [
    { ...CHUNK_BASE, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    { ...CHUNK_BASE, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
  ];
}

function toolCallChunks(name: string, args: object) {
  return [
    {
      ...CHUNK_BASE,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name, arguments: JSON.stringify(args) }
              }
            ]
          },
          finish_reason: null
        }
      ]
    },
    { ...CHUNK_BASE, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }
  ];
}

function userMessage(text: string) {
  return { id: "m1", role: "user", parts: [{ type: "text", text }] };
}

function chatRequest(body: unknown) {
  return jsonRequest("/api/ai/chat", "POST", body);
}

describe("POST /api/ai/chat", () => {
  it("returns 409 ai_not_configured when the user has no AI settings", async () => {
    const res = await chat(
      chatRequest({ messages: [userMessage("hi")], agentId: "deck-advisor" })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ai_not_configured");
  });

  it("rejects an unknown agent and a bad body", async () => {
    await configureAi();

    const unknownAgent = await chat(
      chatRequest({ messages: [userMessage("hi")], agentId: "nope" })
    );
    expect(unknownAgent.status).toBe(400);
    expect((await unknownAgent.json()).error).toMatch(/Unknown agent/);

    const noMessages = await chat(chatRequest({ agentId: "deck-advisor", messages: [] }));
    expect(noMessages.status).toBe(400);
  });

  it("streams a tool-call round trip to a final answer", async () => {
    await configureAi();
    await seedCard({ id: "gob-chat", name: "Goblin Guide", type_line: "Creature — Goblin" });

    const aiRequests: any[] = [];
    mswServer.use(
      http.post(`${AI_BASE}/chat/completions`, async ({ request }) => {
        const body = (await request.json()) as any;
        aiRequests.push(body);
        expect(request.headers.get("authorization")).toBe("Bearer sk-test");
        // First call: the model asks for a search. Second: final text.
        if (aiRequests.length === 1) {
          return sseResponse(toolCallChunks("searchCards", { q: "t:goblin" }));
        }
        return sseResponse(textChunks("Goblin Guide fits your curve."));
      })
    );

    const res = await chat(
      chatRequest({
        messages: [userMessage("suggest a goblin")],
        agentId: "deck-advisor",
        context: { deckId: "507f1f77bcf86cd799439011" }
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-transform");

    const stream = await res.text();
    // The UI-message stream carries the tool call (with its result) and the text.
    expect(stream).toContain("searchCards");
    expect(stream).toContain("Goblin Guide fits your curve.");

    expect(aiRequests).toHaveLength(2);
    // The persona system prompt names the viewed deck and carries the cheat sheet.
    const system = aiRequests[0].messages.find((m: any) => m.role === "system");
    expect(system.content).toContain("507f1f77bcf86cd799439011");
    expect(system.content).toContain("## Basics");
    // The tool schema subset is advertised to the model.
    const toolNames = (aiRequests[0].tools ?? []).map((t: any) => t.function?.name);
    expect(toolNames).toContain("searchCards");
    expect(toolNames).toContain("manaBaseStats");
    // The second request carries the executed tool's result back to the model.
    const toolMsg = aiRequests[1].messages.find((m: any) => m.role === "tool");
    expect(JSON.stringify(toolMsg)).toContain("Goblin Guide");
  });

  it("surfaces provider errors in-stream with real diagnostics", async () => {
    await configureAi();
    mswServer.use(
      http.post(`${AI_BASE}/chat/completions`, () =>
        HttpResponse.json({ error: { message: "invalid api key" } }, { status: 401 })
      )
    );

    const res = await chat(
      chatRequest({ messages: [userMessage("hi")], agentId: "deck-advisor" })
    );
    // Streaming has already begun, so failures arrive as error parts.
    expect(res.status).toBe(200);
    const stream = await res.text();
    expect(stream).toContain("error");
    expect(stream).toMatch(/invalid api key|401/i);
  });
});

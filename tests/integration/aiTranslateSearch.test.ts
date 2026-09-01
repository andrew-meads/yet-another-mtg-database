import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { POST as translateSearch } from "@/app/api/ai/translate-search/route";
import { POST as testConnection } from "@/app/api/ai/status/test/route";
import { PUT as putAiSettings } from "@/app/api/settings/ai/route";
import { jsonRequest, seedUser, setTestUser } from "./helpers";

/**
 * MSW impersonates the user's OpenAI-compatible endpoint at http://ai.test/v1
 * so the routes exercise the real AI SDK request path without any network.
 */
const AI_BASE = "http://ai.test/v1";

function chatCompletion(content: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1700000000,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop"
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
  };
}

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

describe("POST /api/ai/translate-search", () => {
  it("returns 409 ai_not_configured when the user has no AI settings", async () => {
    const res = await translateSearch(
      jsonRequest("/api/ai/translate-search", "POST", { prompt: "cheap red burn spells" })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ai_not_configured");
  });

  it("rejects a missing or oversized prompt", async () => {
    await configureAi();

    const missing = await translateSearch(jsonRequest("/api/ai/translate-search", "POST", {}));
    expect(missing.status).toBe(400);

    const oversized = await translateSearch(
      jsonRequest("/api/ai/translate-search", "POST", { prompt: "x".repeat(2001) })
    );
    expect(oversized.status).toBe(400);
  });

  it("translates a prompt via the configured endpoint", async () => {
    await configureAi();
    mswServer.use(
      http.post(`${AI_BASE}/chat/completions`, async ({ request }) => {
        const body = (await request.json()) as {
          model: string;
          messages: { role: string; content: string }[];
        };
        // The request carries the user's model, the syntax cheat sheet, and the prompt.
        expect(body.model).toBe("test-model");
        expect(request.headers.get("authorization")).toBe("Bearer sk-test");
        const system = body.messages.find((m) => m.role === "system");
        expect(system?.content).toContain("## Basics");
        return HttpResponse.json(
          chatCompletion('{"query": "t:goblin c:r mv<=2", "notes": "Burn is r, not b."}')
        );
      })
    );

    const res = await translateSearch(
      jsonRequest("/api/ai/translate-search", "POST", { prompt: "cheap red goblins" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      query: "t:goblin c:r mv<=2",
      notes: "Burn is r, not b."
    });
  });

  it("returns 502 with the raw reply when the model output is not usable JSON", async () => {
    await configureAi();
    mswServer.use(
      http.post(`${AI_BASE}/chat/completions`, () =>
        HttpResponse.json(chatCompletion("Here are some great goblins for you!"))
      )
    );

    const res = await translateSearch(
      jsonRequest("/api/ai/translate-search", "POST", { prompt: "goblins" })
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/unusable response/);
    expect(body.detail).toMatch(/JSON/);
    expect(body.raw).toBe("Here are some great goblins for you!");
    expect(body.finishReason).toBe("stop");
  });

  it("surfaces an empty reply and its finish reason (e.g. exhausted token budget)", async () => {
    await configureAi();
    mswServer.use(
      http.post(`${AI_BASE}/chat/completions`, () => {
        const completion = chatCompletion("");
        completion.choices[0].finish_reason = "length";
        return HttpResponse.json(completion);
      })
    );

    const res = await translateSearch(
      jsonRequest("/api/ai/translate-search", "POST", { prompt: "goblins" })
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.raw).toBe("");
    expect(body.finishReason).toBe("length");
  });

  it("returns 502 when the AI endpoint rejects the request", async () => {
    await configureAi();
    mswServer.use(
      http.post(`${AI_BASE}/chat/completions`, () =>
        HttpResponse.json({ error: { message: "invalid api key" } }, { status: 401 })
      )
    );

    const res = await translateSearch(
      jsonRequest("/api/ai/translate-search", "POST", { prompt: "goblins" })
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/AI request failed/);
  });
});

describe("POST /api/ai/status/test", () => {
  it("returns 409 when unconfigured", async () => {
    const res = await testConnection(jsonRequest("/api/ai/status/test", "POST"));
    expect(res.status).toBe(409);
  });

  it("returns ok:true when the endpoint answers", async () => {
    await configureAi();
    mswServer.use(
      http.post(`${AI_BASE}/chat/completions`, () => HttpResponse.json(chatCompletion("OK")))
    );

    const res = await testConnection(jsonRequest("/api/ai/status/test", "POST"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 502 ok:false when the endpoint fails", async () => {
    await configureAi();
    mswServer.use(
      http.post(`${AI_BASE}/chat/completions`, () =>
        HttpResponse.json({ error: { message: "nope" } }, { status: 500 })
      )
    );

    const res = await testConnection(jsonRequest("/api/ai/status/test", "POST"));
    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
  });
});

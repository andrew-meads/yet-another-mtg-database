import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/settings/route";
import { PUT as putAiSettings } from "@/app/api/settings/ai/route";
import { GET as getAiStatus } from "@/app/api/ai/status/route";
import { UserSettingsModel } from "@/db/schema";
import { Types } from "mongoose";
import { jsonRequest, seedUser, setTestUser } from "./helpers";

const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
  else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
});

let userId: string;

beforeEach(async () => {
  userId = await seedUser();
  setTestUser(userId);
});

describe("GET /api/settings", () => {
  it("returns an empty settings object for a new user", async () => {
    const res = await getSettings(jsonRequest("/api/settings", "GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settings: {} });
  });
});

describe("PATCH /api/settings", () => {
  it("persists the cardPreview section", async () => {
    const cardPreview = { enabled: false, size: "large", delayMs: 1200 };
    const res = await patchSettings(jsonRequest("/api/settings", "PATCH", { cardPreview }));
    expect(res.status).toBe(200);
    expect((await res.json()).settings.cardPreview).toEqual(cardPreview);

    const readBack = await getSettings(jsonRequest("/api/settings", "GET"));
    expect((await readBack.json()).settings.cardPreview).toEqual(cardPreview);
  });

  it("persists the openEntities section and leaves other sections untouched", async () => {
    const cardPreview = { enabled: true, size: "small", delayMs: 500 };
    await patchSettings(jsonRequest("/api/settings", "PATCH", { cardPreview }));

    const openEntities = [
      { id: new Types.ObjectId().toString(), kind: "collection", pinned: true },
      { id: new Types.ObjectId().toString(), kind: "deck" }
    ];
    const res = await patchSettings(jsonRequest("/api/settings", "PATCH", { openEntities }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.settings.openEntities).toEqual(openEntities);
    expect(body.settings.cardPreview).toEqual(cardPreview);
  });

  it("rejects an empty patch", async () => {
    const res = await patchSettings(jsonRequest("/api/settings", "PATCH", {}));
    expect(res.status).toBe(400);
  });

  it("rejects invalid section payloads", async () => {
    const badPreview = await patchSettings(
      jsonRequest("/api/settings", "PATCH", {
        cardPreview: { enabled: true, size: "gigantic", delayMs: 500 }
      })
    );
    expect(badPreview.status).toBe(400);

    const badEntities = await patchSettings(
      jsonRequest("/api/settings", "PATCH", {
        openEntities: [{ id: "not-an-objectid", kind: "collection" }]
      })
    );
    expect(badEntities.status).toBe(400);

    const badKind = await patchSettings(
      jsonRequest("/api/settings", "PATCH", {
        openEntities: [{ id: new Types.ObjectId().toString(), kind: "binder" }]
      })
    );
    expect(badKind.status).toBe(400);
  });

  it("scopes settings to the requesting user", async () => {
    await patchSettings(
      jsonRequest("/api/settings", "PATCH", {
        cardPreview: { enabled: false, size: "small", delayMs: 700 }
      })
    );

    const otherUser = await seedUser("other@example.com");
    setTestUser(otherUser);
    const res = await getSettings(jsonRequest("/api/settings", "GET"));
    expect(await res.json()).toEqual({ settings: {} });
  });
});

describe("PUT /api/settings/ai", () => {
  it("stores the AI settings and masks the key in the response", async () => {
    const res = await putAiSettings(
      jsonRequest("/api/settings/ai", "PUT", {
        baseUrl: "https://openrouter.ai/api/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-secret-abcd"
      })
    );
    expect(res.status).toBe(200);

    const { settings } = await res.json();
    expect(settings.ai).toEqual({
      baseUrl: "https://openrouter.ai/api/v1",
      model: "gpt-4o-mini",
      hasApiKey: true,
      apiKeyHint: "…abcd"
    });
    expect(JSON.stringify(settings)).not.toContain("sk-secret-abcd");

    // The key is stored sealed (plain.* without an encryption key configured).
    const doc = await UserSettingsModel.findOne({ owner: new Types.ObjectId(userId) }).lean();
    expect(doc?.ai?.apiKeySealed).toBe("plain.sk-secret-abcd");
  });

  it("encrypts the key at rest when SETTINGS_ENCRYPTION_KEY is set", async () => {
    process.env.SETTINGS_ENCRYPTION_KEY = "b".repeat(64);
    await putAiSettings(
      jsonRequest("/api/settings/ai", "PUT", { model: "gpt-4o-mini", apiKey: "sk-secret-abcd" })
    );

    const doc = await UserSettingsModel.findOne({ owner: new Types.ObjectId(userId) }).lean();
    expect(doc?.ai?.apiKeySealed).toMatch(/^enc\.v1\./);
    expect(doc?.ai?.apiKeySealed).not.toContain("sk-secret-abcd");
  });

  it("keeps the stored key when apiKey is omitted and clears it on empty string", async () => {
    await putAiSettings(
      jsonRequest("/api/settings/ai", "PUT", { model: "gpt-4o-mini", apiKey: "sk-secret-abcd" })
    );

    // Update the model only — key must survive.
    const kept = await putAiSettings(jsonRequest("/api/settings/ai", "PUT", { model: "gpt-4o" }));
    const keptBody = await kept.json();
    expect(keptBody.settings.ai).toMatchObject({ model: "gpt-4o", hasApiKey: true });

    // Empty string clears the key.
    const cleared = await putAiSettings(jsonRequest("/api/settings/ai", "PUT", { apiKey: "" }));
    const clearedBody = await cleared.json();
    expect(clearedBody.settings.ai).toMatchObject({ hasApiKey: false });
    expect(clearedBody.settings.ai.apiKeyHint).toBeUndefined();
  });

  it("rejects an invalid base URL", async () => {
    const res = await putAiSettings(
      jsonRequest("/api/settings/ai", "PUT", { baseUrl: "not a url" })
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/ai/status", () => {
  it("reports unconfigured when model or key is missing", async () => {
    const initial = await getAiStatus(jsonRequest("/api/ai/status", "GET"));
    expect(await initial.json()).toEqual({ configured: false });

    // Model without key is still unconfigured.
    await putAiSettings(jsonRequest("/api/settings/ai", "PUT", { model: "gpt-4o-mini" }));
    const modelOnly = await getAiStatus(jsonRequest("/api/ai/status", "GET"));
    expect(await modelOnly.json()).toEqual({ configured: false });
  });

  it("reports configured with model and base URL host once complete", async () => {
    await putAiSettings(
      jsonRequest("/api/settings/ai", "PUT", { model: "gpt-4o-mini", apiKey: "sk-x" })
    );

    const res = await getAiStatus(jsonRequest("/api/ai/status", "GET"));
    expect(await res.json()).toEqual({
      configured: true,
      model: "gpt-4o-mini",
      baseUrlHost: "api.openai.com" // default base URL when unset
    });
  });
});

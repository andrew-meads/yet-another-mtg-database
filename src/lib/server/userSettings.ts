import { z } from "zod";
import { Types } from "mongoose";
import { UserSettingsModel, UserSettingsDoc } from "@/db/schema";
import { open, seal } from "@/lib/server/secretBox";
import {
  AiSettingsMasked,
  CARD_PREVIEW_MAX_DELAY,
  CARD_PREVIEW_MIN_DELAY,
  CardPreviewSettings,
  OpenEntityRef,
  UserSettingsPayload
} from "@/types/UserSettings";

/** Default OpenAI-compatible endpoint used when the user leaves the base URL blank. */
export const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";

// ---------------------------------------------------------------------------
// Request-body schemas (zod)
// ---------------------------------------------------------------------------

export const cardPreviewSchema = z.strictObject({
  enabled: z.boolean(),
  size: z.enum(["small", "normal", "large"]),
  delayMs: z.number().int().min(CARD_PREVIEW_MIN_DELAY).max(CARD_PREVIEW_MAX_DELAY)
});

export const openEntitiesSchema = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[0-9a-f]{24}$/i, "must be an ObjectId string"),
      kind: z.enum(["collection", "deck"]),
      pinned: z.boolean().optional()
    })
  )
  .max(200);

/** Body of PATCH /api/settings — at least one section must be present. */
export const settingsPatchSchema = z
  .strictObject({
    cardPreview: cardPreviewSchema.optional(),
    openEntities: openEntitiesSchema.optional()
  })
  .refine((value) => value.cardPreview !== undefined || value.openEntities !== undefined, {
    message: "Provide at least one settings section"
  });

/**
 * Body of PUT /api/settings/ai. `apiKey` semantics: omitted = keep the stored
 * key, "" = clear it, anything else = replace it. Empty baseUrl/model clear the
 * respective field (baseUrl then falls back to the OpenAI default).
 */
export const aiSettingsPutSchema = z.strictObject({
  baseUrl: z.union([z.literal(""), z.url()]).optional(),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional()
});

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

type LeanUserSettings = Omit<UserSettingsDoc, "owner"> & { owner: Types.ObjectId };

export async function getUserSettingsDoc(userId: string): Promise<LeanUserSettings | null> {
  return UserSettingsModel.findOne({ owner: new Types.ObjectId(userId) }).lean();
}

function maskAi(ai: UserSettingsDoc["ai"]): AiSettingsMasked | undefined {
  if (!ai) return undefined;
  return {
    baseUrl: ai.baseUrl,
    model: ai.model,
    hasApiKey: Boolean(ai.apiKeySealed),
    apiKeyHint: ai.apiKeySealed ? ai.apiKeyHint : undefined
  };
}

/** Project a settings doc to the client-facing shape (AI key masked). */
export function toClientSettings(doc: LeanUserSettings | null): UserSettingsPayload {
  if (!doc) return {};
  return {
    cardPreview: doc.cardPreview as CardPreviewSettings | undefined,
    openEntities: doc.openEntities as OpenEntityRef[] | undefined,
    ai: maskAi(doc.ai)
  };
}

export async function patchUserSettings(
  userId: string,
  patch: z.infer<typeof settingsPatchSchema>
): Promise<LeanUserSettings> {
  const $set: Record<string, unknown> = {};
  if (patch.cardPreview !== undefined) $set.cardPreview = patch.cardPreview;
  if (patch.openEntities !== undefined) $set.openEntities = patch.openEntities;

  return UserSettingsModel.findOneAndUpdate(
    { owner: new Types.ObjectId(userId) },
    { $set },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  ).lean() as Promise<LeanUserSettings>;
}

export async function putAiSettings(
  userId: string,
  input: z.infer<typeof aiSettingsPutSchema>
): Promise<LeanUserSettings> {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, unknown> = {};

  if (input.baseUrl !== undefined) {
    if (input.baseUrl === "") $unset["ai.baseUrl"] = "";
    else $set["ai.baseUrl"] = input.baseUrl;
  }
  if (input.model !== undefined) {
    if (input.model.trim() === "") $unset["ai.model"] = "";
    else $set["ai.model"] = input.model.trim();
  }
  if (input.apiKey !== undefined) {
    if (input.apiKey === "") {
      $unset["ai.apiKeySealed"] = "";
      $unset["ai.apiKeyHint"] = "";
    } else {
      $set["ai.apiKeySealed"] = seal(input.apiKey);
      $set["ai.apiKeyHint"] = `…${input.apiKey.slice(-4)}`;
    }
  }

  const update: Record<string, unknown> = {};
  if (Object.keys($set).length > 0) update.$set = $set;
  if (Object.keys($unset).length > 0) update.$unset = $unset;

  return UserSettingsModel.findOneAndUpdate({ owner: new Types.ObjectId(userId) }, update, {
    upsert: true,
    returnDocument: "after",
    setDefaultsOnInsert: true
  }).lean() as Promise<LeanUserSettings>;
}

// ---------------------------------------------------------------------------
// AI configuration
// ---------------------------------------------------------------------------

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * The user's effective AI configuration, or null when incomplete (no model or no
 * API key). The base URL defaults to the public OpenAI endpoint.
 */
export async function getAiConfig(userId: string): Promise<AiConfig | null> {
  const doc = await getUserSettingsDoc(userId);
  const ai = doc?.ai;
  if (!ai?.model || !ai.apiKeySealed) return null;
  return {
    baseUrl: ai.baseUrl || DEFAULT_AI_BASE_URL,
    model: ai.model,
    apiKey: open(ai.apiKeySealed)
  };
}

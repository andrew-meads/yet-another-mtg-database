import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AiConfig, getAiConfig } from "@/lib/server/userSettings";

/**
 * Thrown when an AI feature is invoked before the user has configured an
 * OpenAI-compatible endpoint (base URL / model / API key) in Settings. API
 * routes map it to `409 { error: "ai_not_configured" }`; the client renders
 * setup guidance for that error code.
 */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured");
    this.name = "AiNotConfiguredError";
  }
}

export const AI_NOT_CONFIGURED = "ai_not_configured";

/** The standard 409 response body for unconfigured AI features. */
export function aiNotConfiguredResponse(): Response {
  return Response.json(
    {
      error: AI_NOT_CONFIGURED,
      message: "AI features need an OpenAI-compatible endpoint. Configure one in Settings."
    },
    { status: 409 }
  );
}

/**
 * Build a language model from the user's stored AI settings. The provider is
 * created per request so settings changes apply immediately and nothing secret
 * lives in module state.
 *
 * @throws AiNotConfiguredError when the user has no complete AI configuration.
 */
export async function getAiModel(userId: string) {
  const config = await getAiConfig(userId);
  if (!config) throw new AiNotConfiguredError();

  const provider = createOpenAICompatible({
    name: "user-configured",
    baseURL: config.baseUrl,
    apiKey: config.apiKey
  });

  return { model: provider(config.model), config: config as AiConfig };
}

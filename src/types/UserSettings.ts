/**
 * Per-user settings synced to the server (the `usersettings` Mongo collection).
 * These shapes are shared by the API routes, the Mongoose schema, and the client
 * contexts/hooks. Sections are optional: an absent section means the user has
 * never customized it (clients fall back to their defaults).
 */

/** Available size variants for the hover card preview. */
export type CardPreviewSize = "small" | "normal" | "large";

/**
 * Min/max bounds for the card-preview delay slider (milliseconds).
 * The minimum matches the historic fixed delay.
 */
export const CARD_PREVIEW_MIN_DELAY = 500;
export const CARD_PREVIEW_MAX_DELAY = 2000;

/** User-configurable settings for the hover card preview (CardPopup). */
export interface CardPreviewSettings {
  /** Whether the hover preview is shown at all */
  enabled: boolean;
  /** On-screen size (and image resolution) of the preview */
  size: CardPreviewSize;
  /** Delay in ms before the preview appears (clamped to 500–2000) */
  delayMs: number;
}

export const DEFAULT_CARD_PREVIEW_SETTINGS: CardPreviewSettings = {
  enabled: true,
  size: "normal",
  delayMs: CARD_PREVIEW_MIN_DELAY
};

/** A reference to a collection or deck the user has open in the workspace. */
export interface OpenEntityRef {
  id: string;
  kind: "collection" | "deck";
  /** Whether the user has pinned this entity to the main bar. Missing = unpinned. */
  pinned?: boolean;
}

/**
 * The AI (OpenAI-compatible endpoint) settings as exposed to the client. The API
 * key itself never leaves the server — only its presence and a short hint.
 */
export interface AiSettingsMasked {
  baseUrl?: string;
  model?: string;
  hasApiKey: boolean;
  /** e.g. "…abcd" — the last few characters of the stored key. */
  apiKeyHint?: string;
}

/** The settings object returned by GET /api/settings (AI section masked). */
export interface UserSettingsPayload {
  cardPreview?: CardPreviewSettings;
  openEntities?: OpenEntityRef[];
  ai?: AiSettingsMasked;
}

export interface UserSettingsResponse {
  settings: UserSettingsPayload;
}

/** Response shape of GET /api/ai/status. */
export interface AiStatusResponse {
  configured: boolean;
  model?: string;
  /** Host of the configured base URL, e.g. "api.openai.com". */
  baseUrlHost?: string;
}

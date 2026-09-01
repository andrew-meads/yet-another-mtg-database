"use client";

import { createContext, useContext } from "react";

import { useServerSetting } from "@/hooks/useServerSetting";
import {
  CARD_PREVIEW_MAX_DELAY,
  CARD_PREVIEW_MIN_DELAY,
  CardPreviewSettings,
  DEFAULT_CARD_PREVIEW_SETTINGS
} from "@/types/UserSettings";

// Re-exported for existing importers; the shapes now live in @/types/UserSettings
// because the server (schema, API routes) shares them.
export { CARD_PREVIEW_MAX_DELAY, CARD_PREVIEW_MIN_DELAY, DEFAULT_CARD_PREVIEW_SETTINGS };
export type { CardPreviewSettings };
export type { CardPreviewSize } from "@/types/UserSettings";

/**
 * The pre-server-sync localStorage key. Migrated to the user's settings
 * document (and removed) on first load by useServerSetting.
 */
const LEGACY_STORAGE_KEY = "settings/card-preview";

interface SettingsContextType {
  cardPreview: CardPreviewSettings;
  setCardPreview: (value: Partial<CardPreviewSettings>) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

/**
 * Clamp the delay into the supported range so stale/out-of-range stored values
 * (or future changes to the bounds) never produce an invalid delay.
 */
function clampDelay(delayMs: number): number {
  if (Number.isNaN(delayMs)) return DEFAULT_CARD_PREVIEW_SETTINGS.delayMs;
  return Math.min(Math.max(delayMs, CARD_PREVIEW_MIN_DELAY), CARD_PREVIEW_MAX_DELAY);
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = useServerSetting<CardPreviewSettings>(
    "cardPreview",
    DEFAULT_CARD_PREVIEW_SETTINGS,
    { legacyStorageKey: LEGACY_STORAGE_KEY }
  );

  // Merge with defaults so a partial/older stored object is always complete.
  const cardPreview: CardPreviewSettings = {
    ...DEFAULT_CARD_PREVIEW_SETTINGS,
    ...stored,
    delayMs: clampDelay(stored?.delayMs ?? DEFAULT_CARD_PREVIEW_SETTINGS.delayMs)
  };

  const setCardPreview = (value: Partial<CardPreviewSettings>) => {
    setStored((prev) => {
      const merged = { ...DEFAULT_CARD_PREVIEW_SETTINGS, ...prev, ...value };
      return { ...merged, delayMs: clampDelay(merged.delayMs) };
    });
  };

  return (
    <SettingsContext.Provider value={{ cardPreview, setCardPreview }}>
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * Access the card-preview settings. Returns immutable defaults and a noop setter
 * when used outside a provider, mirroring CardSelectionContext's safe fallback.
 */
export function useCardPreviewSettings(): SettingsContextType {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    return {
      cardPreview: DEFAULT_CARD_PREVIEW_SETTINGS,
      setCardPreview: () => {}
    };
  }
  return ctx;
}

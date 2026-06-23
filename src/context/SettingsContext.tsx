"use client";

import { createContext, useContext } from "react";

import { useLocalStorage } from "@/hooks/useLocalStorage";

/**
 * Available size variants for the hover card preview.
 */
export type CardPreviewSize = "small" | "normal" | "large";

/**
 * Min/max bounds for the card-preview delay slider (milliseconds).
 * The minimum matches the historic fixed delay.
 */
export const CARD_PREVIEW_MIN_DELAY = 500;
export const CARD_PREVIEW_MAX_DELAY = 2000;

/**
 * User-configurable settings for the hover card preview (CardPopup).
 */
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

/**
 * localStorage key for the card-preview settings object.
 */
const STORAGE_KEY = "settings/card-preview";

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
  const [stored, setStored] = useLocalStorage<CardPreviewSettings>(
    STORAGE_KEY,
    DEFAULT_CARD_PREVIEW_SETTINGS
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

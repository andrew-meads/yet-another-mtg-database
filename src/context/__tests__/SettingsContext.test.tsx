import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import {
  SettingsProvider,
  useCardPreviewSettings,
  DEFAULT_CARD_PREVIEW_SETTINGS,
  CARD_PREVIEW_MIN_DELAY,
  CARD_PREVIEW_MAX_DELAY
} from "@/context/SettingsContext";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(SettingsProvider, null, children);

const KEY = "settings/card-preview";

beforeEach(() => window.localStorage.clear());

describe("SettingsContext", () => {
  it("starts with defaults when nothing is stored", () => {
    const { result } = renderHook(() => useCardPreviewSettings(), { wrapper });
    expect(result.current.cardPreview).toEqual(DEFAULT_CARD_PREVIEW_SETTINGS);
  });

  it("hydrates from an existing stored value", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ enabled: false, size: "large", delayMs: 1200 })
    );
    const { result } = renderHook(() => useCardPreviewSettings(), { wrapper });
    expect(result.current.cardPreview).toEqual({ enabled: false, size: "large", delayMs: 1200 });
  });

  it("merges partial updates and persists them", () => {
    const { result } = renderHook(() => useCardPreviewSettings(), { wrapper });

    act(() => result.current.setCardPreview({ size: "small" }));
    expect(result.current.cardPreview.size).toBe("small");
    // Unspecified fields keep their defaults
    expect(result.current.cardPreview.enabled).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toMatchObject({ size: "small" });

    act(() => result.current.setCardPreview({ enabled: false }));
    expect(result.current.cardPreview).toEqual({ enabled: false, size: "small", delayMs: 500 });
  });

  it("clamps the delay into the supported range", () => {
    const { result } = renderHook(() => useCardPreviewSettings(), { wrapper });

    act(() => result.current.setCardPreview({ delayMs: 100 }));
    expect(result.current.cardPreview.delayMs).toBe(CARD_PREVIEW_MIN_DELAY);

    act(() => result.current.setCardPreview({ delayMs: 9999 }));
    expect(result.current.cardPreview.delayMs).toBe(CARD_PREVIEW_MAX_DELAY);
  });

  it("returns immutable defaults and a noop setter outside a provider", () => {
    const { result } = renderHook(() => useCardPreviewSettings());
    expect(result.current.cardPreview).toEqual(DEFAULT_CARD_PREVIEW_SETTINGS);
    expect(() => result.current.setCardPreview({ enabled: false })).not.toThrow();
  });
});

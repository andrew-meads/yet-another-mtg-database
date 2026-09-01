import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";

/**
 * The server-sync mechanics (hydration, legacy-localStorage migration, debounced
 * PATCH) are covered by useServerSetting's own tests; here it is faked with
 * plain state so these tests focus on the context's merge/clamp logic.
 */
const h = vi.hoisted(() => ({
  seed: undefined as unknown,
  writes: [] as unknown[]
}));

vi.mock("@/hooks/useServerSetting", () => ({
  useServerSetting: (_section: string, initial: unknown) => {
    const [value, setValue] = React.useState(h.seed ?? initial);
    const set = (next: unknown | ((prev: unknown) => unknown)) => {
      setValue((prev: unknown) => {
        const resolved = next instanceof Function ? next(prev) : next;
        h.writes.push(resolved);
        return resolved;
      });
    };
    return [value, set, { hydrated: true }];
  }
}));

import {
  SettingsProvider,
  useCardPreviewSettings,
  DEFAULT_CARD_PREVIEW_SETTINGS,
  CARD_PREVIEW_MIN_DELAY,
  CARD_PREVIEW_MAX_DELAY
} from "@/context/SettingsContext";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(SettingsProvider, null, children);

beforeEach(() => {
  h.seed = undefined;
  h.writes = [];
});

describe("SettingsContext", () => {
  it("starts with defaults when nothing is stored", () => {
    const { result } = renderHook(() => useCardPreviewSettings(), { wrapper });
    expect(result.current.cardPreview).toEqual(DEFAULT_CARD_PREVIEW_SETTINGS);
  });

  it("hydrates from an existing stored value", () => {
    h.seed = { enabled: false, size: "large", delayMs: 1200 };
    const { result } = renderHook(() => useCardPreviewSettings(), { wrapper });
    expect(result.current.cardPreview).toEqual({ enabled: false, size: "large", delayMs: 1200 });
  });

  it("completes a partial stored value with defaults", () => {
    h.seed = { size: "large" };
    const { result } = renderHook(() => useCardPreviewSettings(), { wrapper });
    expect(result.current.cardPreview).toEqual({
      ...DEFAULT_CARD_PREVIEW_SETTINGS,
      size: "large"
    });
  });

  it("merges partial updates and persists them", () => {
    const { result } = renderHook(() => useCardPreviewSettings(), { wrapper });

    act(() => result.current.setCardPreview({ size: "small" }));
    expect(result.current.cardPreview.size).toBe("small");
    // Unspecified fields keep their defaults
    expect(result.current.cardPreview.enabled).toBe(true);
    expect(h.writes.at(-1)).toMatchObject({ size: "small" });

    act(() => result.current.setCardPreview({ enabled: false }));
    expect(result.current.cardPreview).toEqual({ enabled: false, size: "small", delayMs: 500 });
    expect(h.writes.at(-1)).toEqual({ enabled: false, size: "small", delayMs: 500 });
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

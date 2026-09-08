import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  currency: "USD",
  rate: undefined as undefined | { rate: number },
  isLoading: false
}));

vi.mock("@/context/SettingsContext", () => ({
  usePricingSettings: () => ({ pricing: { currency: h.currency }, setPricing: vi.fn() })
}));
vi.mock("@/hooks/react-query/useExchangeRate", () => ({
  useExchangeRate: () => ({ data: h.rate, isLoading: h.isLoading })
}));

import { useCurrency } from "@/hooks/useCurrency";

beforeEach(() => {
  h.currency = "USD";
  h.rate = undefined;
  h.isLoading = false;
});

describe("useCurrency", () => {
  it("formats USD directly with rate 1", () => {
    const { result } = renderHook(() => useCurrency());
    expect(result.current.currency).toBe("USD");
    expect(result.current.rate).toBe(1);
    expect(result.current.format(12.5)).toBe("$12.50");
    expect(result.current.format(null)).toBeNull();
  });

  it("converts with the fetched rate once available", () => {
    h.currency = "NZD";
    h.rate = { rate: 1.6 };
    const { result } = renderHook(() => useCurrency());
    expect(result.current.currency).toBe("NZD");
    expect(result.current.rate).toBe(1.6);
    expect(result.current.format(10)).toMatch(/16\.00/);
  });

  it("degrades to USD while the rate is loading or unavailable", () => {
    h.currency = "NZD";
    h.isLoading = true;
    const { result } = renderHook(() => useCurrency());
    expect(result.current.currency).toBe("USD");
    expect(result.current.configured).toBe("NZD");
    expect(result.current.loading).toBe(true);
    expect(result.current.format(10)).toBe("$10.00");
  });
});

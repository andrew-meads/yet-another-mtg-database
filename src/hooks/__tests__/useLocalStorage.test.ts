import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalStorage } from "@/hooks/useLocalStorage";

beforeEach(() => window.localStorage.clear());

describe("useLocalStorage", () => {
  it("falls back to the initial value when nothing is stored", () => {
    const { result } = renderHook(() => useLocalStorage("k", "default"));
    expect(result.current[0]).toBe("default");
  });

  it("hydrates from an existing stored value", () => {
    window.localStorage.setItem("k", JSON.stringify("stored"));
    const { result } = renderHook(() => useLocalStorage("k", "default"));
    expect(result.current[0]).toBe("stored");
  });

  it("persists writes to localStorage", () => {
    const { result } = renderHook(() => useLocalStorage<number>("count", 0));
    act(() => result.current[1](5));
    expect(result.current[0]).toBe(5);
    expect(window.localStorage.getItem("count")).toBe("5");
  });

  it("supports functional updates", () => {
    const { result } = renderHook(() => useLocalStorage<number>("count", 1));
    act(() => result.current[1]((prev) => prev + 1));
    expect(result.current[0]).toBe(2);
  });

  it("recovers from malformed stored JSON", () => {
    window.localStorage.setItem("k", "{not json");
    const { result } = renderHook(() => useLocalStorage("k", "fallback"));
    expect(result.current[0]).toBe("fallback");
  });
});

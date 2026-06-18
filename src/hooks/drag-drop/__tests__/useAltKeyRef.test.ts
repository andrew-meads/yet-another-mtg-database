import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { useAltKeyRef } from "@/hooks/drag-drop/useAltKeyRef";

describe("useAltKeyRef", () => {
  it("flips to true on Alt keydown and back to false on keyup", () => {
    const { result } = renderHook(() => useAltKeyRef());
    expect(result.current.current).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    });
    expect(result.current.current).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    });
    expect(result.current.current).toBe(false);
  });

  it("ignores other keys", () => {
    const { result } = renderHook(() => useAltKeyRef());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    });
    expect(result.current.current).toBe(false);
  });

  it("resets to false on window blur", () => {
    const { result } = renderHook(() => useAltKeyRef());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    });
    expect(result.current.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current.current).toBe(false);
  });
});

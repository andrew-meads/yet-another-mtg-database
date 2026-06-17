import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useIsDesktop } from "@/hooks/useIsDesktop";

afterEach(() => vi.restoreAllMocks());

function mockMatchMedia(matches: boolean) {
  const remove = vi.fn();
  const add = vi.fn();
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: add,
        removeEventListener: remove,
        dispatchEvent: vi.fn()
      }) as unknown as MediaQueryList
  );
  return { add, remove };
}

describe("useIsDesktop", () => {
  it("reports desktop when the media query matches and flags mounted", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current.mounted).toBe(true);
    expect(result.current.isDesktop).toBe(true);
  });

  it("reports non-desktop when the media query does not match", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current.isDesktop).toBe(false);
  });

  it("subscribes to and cleans up the change listener", () => {
    const { add, remove } = mockMatchMedia(false);
    const { unmount } = renderHook(() => useIsDesktop());
    expect(add).toHaveBeenCalledWith("change", expect.any(Function));
    unmount();
    expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
  });
});

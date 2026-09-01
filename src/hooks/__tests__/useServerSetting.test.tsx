import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useServerSetting } from "@/hooks/useServerSetting";

const h = vi.hoisted(() => ({
  query: { data: undefined as unknown, isSuccess: false },
  mutate: vi.fn(),
  mutateSucceeds: true
}));

vi.mock("@/hooks/react-query/useUserSettings", () => ({
  useUserSettings: () => h.query
}));
vi.mock("@/hooks/react-query/useUpdateUserSettings", () => ({
  useUpdateUserSettings: () => ({ mutate: h.mutate })
}));

const DEFAULTS = { enabled: true, size: "normal", delayMs: 500 };

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  h.query = { data: undefined, isSuccess: false };
  h.mutateSucceeds = true;
  h.mutate.mockImplementation((_payload: unknown, opts?: { onSuccess?: () => void }) => {
    if (h.mutateSucceeds) opts?.onSuccess?.();
  });
});

afterEach(() => vi.useRealTimers());

function setServerSettings(settings: Record<string, unknown>) {
  h.query = { data: { settings }, isSuccess: true };
}

describe("useServerSetting", () => {
  it("returns the initial value before hydration and applies local edits without persisting", () => {
    const { result } = renderHook(() => useServerSetting("cardPreview", DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
    expect(result.current[2].hydrated).toBe(false);

    act(() => result.current[1]({ ...DEFAULTS, enabled: false }));
    expect(result.current[0].enabled).toBe(false);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("adopts the server value on hydration", () => {
    const server = { enabled: false, size: "large", delayMs: 1200 };
    setServerSettings({ cardPreview: server });

    const { result } = renderHook(() => useServerSetting("cardPreview", DEFAULTS));
    expect(result.current[0]).toEqual(server);
    expect(result.current[2].hydrated).toBe(true);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("removes a stale legacy key when the server already has a value", () => {
    window.localStorage.setItem("legacy-key", JSON.stringify({ enabled: true }));
    setServerSettings({ cardPreview: { enabled: false, size: "small", delayMs: 500 } });

    renderHook(() =>
      useServerSetting("cardPreview", DEFAULTS, { legacyStorageKey: "legacy-key" })
    );
    expect(window.localStorage.getItem("legacy-key")).toBeNull();
  });

  it("migrates a legacy localStorage value when the server has none", () => {
    const legacy = { enabled: false, size: "small", delayMs: 700 };
    window.localStorage.setItem("legacy-key", JSON.stringify(legacy));
    setServerSettings({});

    const { result } = renderHook(() =>
      useServerSetting("cardPreview", DEFAULTS, { legacyStorageKey: "legacy-key" })
    );

    expect(result.current[0]).toEqual(legacy);
    expect(h.mutate).toHaveBeenCalledWith({ cardPreview: legacy }, expect.anything());
    // Removed only after the write succeeded.
    expect(window.localStorage.getItem("legacy-key")).toBeNull();
  });

  it("keeps the legacy key when the migration write fails", () => {
    h.mutateSucceeds = false;
    const legacy = { enabled: false, size: "small", delayMs: 700 };
    window.localStorage.setItem("legacy-key", JSON.stringify(legacy));
    setServerSettings({});

    renderHook(() =>
      useServerSetting("cardPreview", DEFAULTS, { legacyStorageKey: "legacy-key" })
    );
    expect(window.localStorage.getItem("legacy-key")).not.toBeNull();
  });

  it("debounces persistence of local edits after hydration", () => {
    vi.useFakeTimers();
    setServerSettings({});
    const { result } = renderHook(() => useServerSetting("cardPreview", DEFAULTS));

    act(() => result.current[1]({ ...DEFAULTS, delayMs: 600 }));
    act(() => result.current[1]({ ...DEFAULTS, delayMs: 700 }));
    expect(h.mutate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(700));
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate).toHaveBeenCalledWith({ cardPreview: { ...DEFAULTS, delayMs: 700 } }, {});
  });

  it("reconciles edits made before hydration with the server value and persists the merge", () => {
    const { result, rerender } = renderHook(() =>
      useServerSetting<{ id: string }[]>("openEntities", [], {
        reconcile: (server, local) => [
          ...server,
          ...local.filter((l) => !server.some((s) => s.id === l.id))
        ]
      })
    );

    // Edit while the settings request is still in flight.
    act(() => result.current[1]([{ id: "local-1" }]));

    setServerSettings({ openEntities: [{ id: "server-1" }] });
    rerender();

    expect(result.current[0]).toEqual([{ id: "server-1" }, { id: "local-1" }]);
    expect(h.mutate).toHaveBeenCalledWith(
      { openEntities: [{ id: "server-1" }, { id: "local-1" }] },
      {}
    );
  });

  it("supports functional updates", () => {
    setServerSettings({});
    const { result } = renderHook(() => useServerSetting<number[]>("openEntities" as never, []));

    act(() => result.current[1]((prev) => [...prev, 1]));
    act(() => result.current[1]((prev) => [...prev, 2]));
    expect(result.current[0]).toEqual([1, 2]);
  });
});

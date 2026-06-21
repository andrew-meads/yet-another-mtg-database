import { describe, it, expect } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { SearchAddMetaProvider, useSearchAddMeta } from "@/context/SearchAddMetaContext";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(SearchAddMetaProvider, null, children);

describe("SearchAddMetaContext", () => {
  it("starts with empty notes and tags", () => {
    const { result } = renderHook(() => useSearchAddMeta(), { wrapper });
    expect(result.current.notes).toBe("");
    expect(result.current.tags).toEqual([]);
  });

  it("updates notes via setNotes", () => {
    const { result } = renderHook(() => useSearchAddMeta(), { wrapper });
    act(() => result.current.setNotes("foil"));
    expect(result.current.notes).toBe("foil");
  });

  it("updates tags via setTags", () => {
    const { result } = renderHook(() => useSearchAddMeta(), { wrapper });
    act(() => result.current.setTags(["commander", "foil"]));
    expect(result.current.tags).toEqual(["commander", "foil"]);
  });

  it("returns safe noop fallback when used outside a provider", () => {
    const { result } = renderHook(() => useSearchAddMeta());
    expect(result.current.notes).toBe("");
    expect(result.current.tags).toEqual([]);
    expect(() => result.current.setNotes("test")).not.toThrow();
    expect(() => result.current.setTags(["test"])).not.toThrow();
  });
});

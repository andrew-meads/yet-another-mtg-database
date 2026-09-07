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

  it("defaults finish/condition to non-foil / NM and exposes empty createFields", () => {
    const { result } = renderHook(() => useSearchAddMeta(), { wrapper });
    expect(result.current.finish).toBe("nonfoil");
    expect(result.current.condition).toBe("NM");
    expect(result.current.createFields).toEqual({ notes: undefined, tags: undefined });
  });

  it("updates finish/condition and reflects non-defaults in createFields", () => {
    const { result } = renderHook(() => useSearchAddMeta(), { wrapper });
    act(() => {
      result.current.setFinish("foil");
      result.current.setCondition("LP");
      result.current.setNotes("signed");
    });
    expect(result.current.finish).toBe("foil");
    expect(result.current.condition).toBe("LP");
    expect(result.current.createFields).toEqual({
      notes: "signed",
      tags: undefined,
      finish: "foil",
      condition: "LP"
    });
    act(() => result.current.setFinish("nonfoil"));
    expect(result.current.createFields.finish).toBeUndefined();
  });

  it("returns safe noop fallback when used outside a provider", () => {
    const { result } = renderHook(() => useSearchAddMeta());
    expect(result.current.notes).toBe("");
    expect(result.current.tags).toEqual([]);
    expect(() => result.current.setNotes("test")).not.toThrow();
    expect(() => result.current.setTags(["test"])).not.toThrow();
    expect(result.current.finish).toBe("nonfoil");
    expect(result.current.condition).toBe("NM");
    expect(() => result.current.setFinish("foil")).not.toThrow();
    expect(() => result.current.setCondition("HP")).not.toThrow();
    expect(result.current.createFields).toEqual({});
  });
});

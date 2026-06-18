import { describe, it, expect } from "vitest";
import { dragCountForItem } from "@/hooks/drag-drop/dragCount";

const ids = ["a", "b", "c", "d"];

describe("dragCountForItem", () => {
  it("returns all ids when count is the full quantity", () => {
    expect(dragCountForItem({ ids, count: 4, altHeld: false })).toEqual(["a", "b", "c", "d"]);
  });

  it("returns the first N ids for a partial count", () => {
    expect(dragCountForItem({ ids, count: 2, altHeld: false })).toEqual(["a", "b"]);
  });

  it("returns exactly one id when Alt is held, regardless of count", () => {
    expect(dragCountForItem({ ids, count: 4, altHeld: true })).toEqual(["a"]);
  });

  it("clamps a count below 1 up to a single id", () => {
    expect(dragCountForItem({ ids, count: 0, altHeld: false })).toEqual(["a"]);
  });

  it("clamps a count above the quantity down to all ids", () => {
    expect(dragCountForItem({ ids, count: 99, altHeld: false })).toEqual(["a", "b", "c", "d"]);
  });

  it("returns an empty array when there are no ids", () => {
    expect(dragCountForItem({ ids: [], count: 1, altHeld: false })).toEqual([]);
    expect(dragCountForItem({ ids: [], count: 1, altHeld: true })).toEqual([]);
  });
});

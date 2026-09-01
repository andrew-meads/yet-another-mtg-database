import { describe, it, expect } from "vitest";
import { extractSetDates } from "@/lib/scryfallSets";

describe("extractSetDates", () => {
  it("maps lowercased set codes to release dates", () => {
    const dates = extractSetDates([
      { code: "LEA", released_at: "1993-08-05", name: "Limited Edition Alpha" },
      { code: "eld", released_at: "2019-10-04" }
    ]);
    expect(dates.get("lea")).toBe("1993-08-05");
    expect(dates.get("eld")).toBe("2019-10-04");
    expect(dates.size).toBe(2);
  });

  it("skips malformed entries", () => {
    const dates = extractSetDates([
      null,
      "not an object",
      { released_at: "2020-01-01" },
      { code: "abc" },
      { code: "", released_at: "2020-01-01" },
      { code: "def", released_at: "" },
      { code: 123, released_at: "2020-01-01" },
      { code: "ok", released_at: "2020-01-01" }
    ]);
    expect([...dates.entries()]).toEqual([["ok", "2020-01-01"]]);
  });
});

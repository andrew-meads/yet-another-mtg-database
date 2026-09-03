import { describe, it, expect } from "vitest";
import { normalizeCardName, relaxedNameRegex } from "@/lib/cardNames";

describe("normalizeCardName", () => {
  it("strips punctuation and lowercases", () => {
    expect(normalizeCardName('"Ach! Hans, Run!"')).toBe("ach hans run");
    expect(normalizeCardName("Ach Hans Run")).toBe("ach hans run");
    expect(normalizeCardName("Fire // Ice")).toBe("fire ice");
  });

  it("keeps unicode letters and collapses whitespace", () => {
    expect(normalizeCardName("Lim-Dûl's   Vault")).toBe("lim dûl s vault");
    expect(normalizeCardName("  Juzám Djinn  ")).toBe("juzám djinn");
  });
});

describe("relaxedNameRegex", () => {
  it("matches the real punctuated name from a bare-token query", () => {
    const rx = relaxedNameRegex("Ach Hans Run")!;
    expect(rx.test('"Ach! Hans, Run!"')).toBe(true);
    expect(rx.test("Ach! Hans, Run!")).toBe(true);
    expect(rx.test("Ach Hans Runs")).toBe(false);
    expect(rx.test("Hans Runs Away")).toBe(false);
  });

  it("is symmetric enough to take the punctuated form as input too", () => {
    const rx = relaxedNameRegex('"Ach! Hans, Run!"')!;
    expect(rx.test('"Ach! Hans, Run!"')).toBe(true);
  });

  it("returns null when nothing normalizable remains", () => {
    expect(relaxedNameRegex("!!!")).toBeNull();
    expect(relaxedNameRegex("  ")).toBeNull();
  });
});

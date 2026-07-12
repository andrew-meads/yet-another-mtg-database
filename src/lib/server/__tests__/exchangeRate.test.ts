import { describe, it, expect } from "vitest";
import { isValidCurrencyCode, parseFrankfurterResponse } from "@/lib/server/exchangeRate";

describe("isValidCurrencyCode", () => {
  it("accepts three uppercase letters", () => {
    expect(isValidCurrencyCode("USD")).toBe(true);
    expect(isValidCurrencyCode("NZD")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidCurrencyCode("usd")).toBe(false);
    expect(isValidCurrencyCode("US")).toBe(false);
    expect(isValidCurrencyCode("USDD")).toBe(false);
    expect(isValidCurrencyCode("US1")).toBe(false);
    expect(isValidCurrencyCode("")).toBe(false);
  });
});

describe("parseFrankfurterResponse", () => {
  it("reads the target rate", () => {
    expect(parseFrankfurterResponse({ rates: { NZD: 1.63 } }, "NZD")).toBe(1.63);
  });

  it("throws when the target rate is missing", () => {
    expect(() => parseFrankfurterResponse({ rates: { EUR: 0.9 } }, "NZD")).toThrow();
    expect(() => parseFrankfurterResponse({}, "NZD")).toThrow();
  });
});

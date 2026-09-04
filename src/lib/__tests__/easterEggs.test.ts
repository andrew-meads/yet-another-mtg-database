import { describe, it, expect } from "vitest";
import { isNoughtyQuery, NOUGHTY_NAME } from "@/lib/easterEggs";

describe("isNoughtyQuery", () => {
  it.each([
    "noughty the dreadnought",
    "Noughty the Dreadnought",
    "NOUGHTY THE DREADNOUGHT",
    "  noughty   the\tdreadnought ",
    '"noughty the dreadnought"',
    "'Noughty the Dreadnought'",
    "name:noughty the dreadnought",
    'name:"noughty the dreadnought"',
    "NAME:'Noughty The Dreadnought'",
    '!"noughty the dreadnought"',
    NOUGHTY_NAME
  ])("matches %j", (query) => {
    expect(isNoughtyQuery(query)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "noughty",
    "the dreadnought",
    "noughty the dreadnought t:creature",
    "c:r noughty the dreadnought",
    "o:noughty the dreadnought",
    'name:"noughty the dreadnought" c:r',
    '"noughty the dreadnought',
    'noughty the dreadnought"',
    "noughty the dreadnoughts",
    "phyrexian dreadnought"
  ])("rejects %j", (query) => {
    expect(isNoughtyQuery(query)).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isNoughtyQuery(null)).toBe(false);
    expect(isNoughtyQuery(undefined)).toBe(false);
  });
});

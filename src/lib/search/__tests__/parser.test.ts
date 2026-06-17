import { describe, it, expect } from "vitest";
import { tokenizeQuery, parseTerm } from "@/lib/search/parser";

describe("tokenizeQuery", () => {
  it("splits on whitespace", () => {
    expect(tokenizeQuery("c:red t:creature")).toEqual(["c:red", "t:creature"]);
  });

  it("keeps double-quoted values as one token", () => {
    expect(tokenizeQuery('o:"draw a card"')).toEqual(["o:draw a card"]);
  });

  it("keeps single-quoted values as one token", () => {
    expect(tokenizeQuery("name:'lightning bolt'")).toEqual(["name:lightning bolt"]);
  });

  it("emits parentheses and 'or' as separate tokens", () => {
    expect(tokenizeQuery("c:red (t:goblin or t:elf)")).toEqual([
      "c:red",
      "(",
      "t:goblin",
      "or",
      "t:elf",
      ")"
    ]);
  });

  it("collapses repeated whitespace and trims", () => {
    expect(tokenizeQuery("  c:red    t:elf ")).toEqual(["c:red", "t:elf"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(tokenizeQuery("")).toEqual([]);
  });
});

describe("parseTerm", () => {
  it("parses key:value", () => {
    expect(parseTerm("c:red")).toEqual({ key: "c", value: "red", negated: false });
  });

  it("parses comparison operators", () => {
    expect(parseTerm("mv>=3")).toEqual({ key: "mv", operator: ">=", value: "3", negated: false });
    expect(parseTerm("pow>5")).toEqual({ key: "pow", operator: ">", value: "5", negated: false });
    expect(parseTerm("loy=3")).toEqual({ key: "loy", operator: "=", value: "3", negated: false });
  });

  it("flags negation and strips the leading dash", () => {
    expect(parseTerm("-t:creature")).toEqual({ key: "t", value: "creature", negated: true });
  });

  it("treats a bare term as a keyless value", () => {
    expect(parseTerm("dragon")).toEqual({ key: null, value: "dragon", negated: false });
  });

  it("keeps colons inside the value (only splits on the first)", () => {
    expect(parseTerm("o:tap: add")).toEqual({ key: "o", value: "tap: add", negated: false });
  });
});

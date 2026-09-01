import { describe, it, expect } from "vitest";
import { isRulesCacheFresh, keywordToRuleNumber, RULES_CACHE_STALENESS_MS } from "@/lib/server/rulesLookup";
import { extractRulings, isRulingFresh, RULING_STALENESS_MS } from "@/lib/server/cardRulings";

describe("keywordToRuleNumber", () => {
  const lists = {
    keywordAbilities: ["Deathtouch", "Defender", "Double Strike"],
    keywordActions: ["Activate", "Attach"]
  };

  it("maps keyword abilities to 702.x by list position", () => {
    expect(keywordToRuleNumber("deathtouch", lists)).toBe("702.2");
    expect(keywordToRuleNumber("Double Strike", lists)).toBe("702.4");
  });

  it("maps keyword actions to 701.x by list position", () => {
    expect(keywordToRuleNumber("activate", lists)).toBe("701.2");
    expect(keywordToRuleNumber("ATTACH", lists)).toBe("701.3");
  });

  it("returns null for unknown terms and missing lists", () => {
    expect(keywordToRuleNumber("banding", lists)).toBeNull();
    expect(keywordToRuleNumber("deathtouch", {})).toBeNull();
  });
});

describe("staleness windows", () => {
  it("rules cache entries expire after 24h", () => {
    const now = Date.now();
    expect(isRulesCacheFresh(new Date(now - RULES_CACHE_STALENESS_MS + 1000), now)).toBe(true);
    expect(isRulesCacheFresh(new Date(now - RULES_CACHE_STALENESS_MS - 1000), now)).toBe(false);
    expect(isRulesCacheFresh(undefined, now)).toBe(false);
  });

  it("ruling entries expire after 7 days", () => {
    const now = Date.now();
    expect(isRulingFresh(new Date(now - RULING_STALENESS_MS + 1000), now)).toBe(true);
    expect(isRulingFresh(new Date(now - RULING_STALENESS_MS - 1000), now)).toBe(false);
  });
});

describe("extractRulings", () => {
  it("keeps comment-bearing entries and defaults missing fields", () => {
    expect(
      extractRulings({
        data: [
          { source: "wotc", published_at: "2020-01-01", comment: "It works." },
          { comment: "Bare comment" },
          { source: "wotc", published_at: "2020-01-01" }
        ]
      })
    ).toEqual([
      { source: "wotc", published_at: "2020-01-01", comment: "It works." },
      { source: "", published_at: "", comment: "Bare comment" }
    ]);
  });

  it("handles a missing data array", () => {
    expect(extractRulings({})).toEqual([]);
  });
});

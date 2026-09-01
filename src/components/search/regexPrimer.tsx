import { DocSection } from "@/components/search/searchDocs";

/**
 * A practical regular-expression primer for the search-help panel's "Regular
 * expressions" tab, rendered by the same `SearchDocsContent` component as the
 * syntax reference. Every example is a runnable query (clickable in the UI) and
 * is guarded by a unit test that checks it still parses against the engine.
 */
export const REGEX_PRIMER_SECTIONS: DocSection[] = [
  {
    id: "regex-basics",
    title: "The basics",
    intro:
      "A regular expression (regex) is a pattern for matching text. On the o:, name:, and t: operators, wrap the value in /slashes/ to match it as a regex instead of literal text. Matching is case-insensitive and finds the pattern anywhere in the field unless you anchor it (see below).",
    entries: [
      {
        syntax: ".",
        description:
          "Matches any single character. draw . cards matches “draw a card” as well as “draw 3 cards”.",
        examples: ["o:/draw . cards?/"]
      },
      {
        syntax: "?",
        description:
          "Makes the preceding item optional (it may appear 0 or 1 times) — cards? matches both “card” and “cards”, discards? matches “discard” and “discards”.",
        examples: ["o:/discards? a card/"]
      },
      {
        syntax: "* +",
        description:
          "Repetition of the preceding item: * means “any number of times, including none”, + means “at least once”. .* is the classic “anything here” wildcard.",
        examples: ["o:/gain .* life/", "o:/deals [0-9]+ damage/"]
      },
      {
        syntax: "{n,m}",
        description:
          "A counted repetition of the preceding item: .{1,3} means “one to three characters”, tighter than .* — handy for matching a small number or word.",
        examples: ["o:/draw .{1,3} cards/"]
      }
    ]
  },
  {
    id: "regex-anchors",
    title: "Anchors & alternatives",
    entries: [
      {
        syntax: "^",
        description:
          "Anchors the match to the START of the text: t:/^legendary creature/ means the type line begins with “Legendary Creature”, not merely contains it somewhere.",
        examples: ["t:/^legendary creature/"]
      },
      {
        syntax: "$",
        description: "Anchors the match to the END of the text.",
        examples: ["name:/dragon$/"]
      },
      {
        syntax: "(a|b)",
        description:
          "Alternation: matches either side of the |. Parentheses group, so anchors and repetition apply to the whole group.",
        examples: ["name:/^lightning (bolt|strike)$/", "o:/(two|three|four) cards/"]
      }
    ]
  },
  {
    id: "regex-classes",
    title: "Character classes",
    entries: [
      {
        syntax: "[abc] [0-9]",
        description:
          "Matches ONE character from a set or range: [0-9] is any digit, [wubrg] any of those five letters.",
        examples: ["o:/gains? [0-9]+ life/"]
      },
      {
        syntax: "[^…]",
        description:
          "A ^ INSIDE brackets negates the set: any one character EXCEPT these. (Only at the start of a pattern does ^ mean “starts with”.)",
        examples: ["o:/\\{[^t]\\}: add/"]
      },
      {
        syntax: "\\b \\d",
        description:
          "Shorthands: \\b is a word boundary (whole-word match — fear but not “fearless”), \\d is any digit (same as [0-9]).",
        examples: ["o:/\\bfear\\b/"]
      }
    ]
  },
  {
    id: "regex-escaping",
    title: "Escaping special characters",
    intro:
      "The characters . ? * + ( ) [ ] { } ^ $ | \\ / have special meanings. Put a backslash in front of one to match it literally: \\. is a real period, \\/ a real slash, \\{ \\} the braces around mana and tap symbols.",
    entries: [
      {
        syntax: "\\",
        description:
          "Escaped braces match symbols like {T} or {G} literally; an escaped slash matches things like +1/+1.",
        examples: ["o:/\\{t\\}: add/", "o:/\\+1\\/\\+1 counter/"]
      },
      {
        description:
          "Putting it together: non-green creatures that tap for mana, with the tap symbol written as an escaped regex.",
        examples: ["t:creature -c:green o:/\\{t\\}: add/"]
      }
    ]
  }
];

/**
 * Structured reference for the Scryfall-style search syntax, rendered by
 * `SearchDocsContent`/`SearchDocsPanel`. The aliases mirror the operators registered in
 * `src/lib/search/config.ts`; the semantics and examples are authored from the
 * operator implementations in `src/lib/search/operators/` and the boolean logic
 * in `src/lib/search/queryBuilder.ts`. Keep this in sync when operators change.
 */

export interface DocEntry {
  /** The canonical syntax token, e.g. `mv` or `c` (shown monospaced). Omit for plain example rows. */
  syntax?: string;
  /** Other accepted keys for the same operator. */
  aliases?: string[];
  /** One-line description of what it matches. */
  description: string;
  /** Runnable example queries (clickable in the UI). */
  examples: string[];
}

export interface DocSection {
  id: string;
  title: string;
  /** Optional intro paragraph shown under the section title. */
  intro?: string;
  entries: DocEntry[];
}

export const SEARCH_DOC_SECTIONS: DocSection[] = [
  {
    id: "basics",
    title: "Basics",
    intro:
      "Combine terms to narrow your search. Plain words match a card's name; add a key like t: or c: to match a specific field. All searches are case-insensitive.",
    entries: [
      {
        syntax: "word",
        description:
          "A term with no key matches the card name (and flavor name) as a substring.",
        examples: ["dragon", "lightning"]
      },
      {
        syntax: '"…"',
        description:
          "Wrap multi-word values in single or double quotes to keep them together.",
        examples: ['"black lotus"', 'o:"draw a card"']
      },
      {
        syntax: "a b",
        description:
          "Two terms next to each other mean AND — a card must match both.",
        examples: ["c:red t:creature", "t:instant mv<=2"]
      },
      {
        syntax: "or",
        description: "Match either side. Combine with grouping for complex logic.",
        examples: ["t:goblin or t:elf"]
      },
      {
        syntax: "( … )",
        description: "Parentheses group terms so OR and AND combine the way you intend.",
        examples: ["c:red (t:goblin or t:elf)"]
      },
      {
        syntax: "-",
        description: "Prefix any term with a minus sign to exclude (negate) it.",
        examples: ["t:creature -c:w", "-t:land"]
      }
    ]
  },
  {
    id: "text",
    title: "Card text & names",
    entries: [
      {
        syntax: "name",
        description: "Card name (also matches the flavor name).",
        examples: ["name:bolt", 'name:"serra angel"']
      },
      {
        syntax: "t",
        aliases: ["type"],
        description: "Type line — supertypes, card types, and subtypes.",
        examples: ["t:creature", "t:legendary", "t:goblin"]
      },
      {
        syntax: "o",
        aliases: ["oracle"],
        description: "Oracle (rules) text.",
        examples: ["o:flying", 'o:"draw a card"']
      },
      {
        syntax: "kw",
        aliases: ["keyword"],
        description: "A keyword ability listed on the card.",
        examples: ["kw:flying", "kw:trample"]
      },
      {
        syntax: "fn",
        aliases: ["flavor", "flavorname"],
        description: "Flavor name only (e.g. Godzilla-series alternate names).",
        examples: ["fn:godzilla"]
      }
    ]
  },
  {
    id: "colors",
    title: "Colors & color identity",
    intro:
      "Values can be letters (w u b r g), full names (white…), colorless (c), or guild/shard/wedge names (azorius, esper, jeskai…). The operator changes the match: c:red and c>=ur mean “contains at least”, c=… means “exactly these”, and c<=… means “only these (a subset)”.",
    entries: [
      {
        syntax: "c",
        aliases: ["color"],
        description: "The card's colors.",
        examples: ["c:red", "c:azorius", "c=w", "c<=ur", "c:c"]
      },
      {
        syntax: "id",
        aliases: ["identity"],
        description: "Color identity — all colors in costs and rules text (Commander).",
        examples: ["id=esper", "id<=rg", "id:colorless"]
      }
    ]
  },
  {
    id: "numbers",
    title: "Numbers",
    intro:
      "Use =, >, <, >=, or <= (and != for power/toughness/loyalty). Comparisons are numeric, so * or X only work with an exact = match.",
    entries: [
      {
        syntax: "mv",
        aliases: ["cmc", "manavalue"],
        description: "Mana value. Also accepts the special values even and odd.",
        examples: ["mv=3", "mv>=5", "mv<=2", "mv:even"]
      },
      {
        syntax: "pow",
        aliases: ["power"],
        description: "Power. Use =* to match cards with variable power.",
        examples: ["pow>=4", "pow=*", "pow!=0"]
      },
      {
        syntax: "tou",
        aliases: ["toughness"],
        description: "Toughness.",
        examples: ["tou<=2", "tou=*"]
      },
      {
        syntax: "loy",
        aliases: ["loyalty"],
        description: "Starting loyalty (planeswalkers).",
        examples: ["loy>=4", "loy=3"]
      },
      {
        syntax: "r",
        aliases: ["rarity"],
        description:
          "Rarity, ordered common < uncommon < rare < mythic — so comparisons work.",
        examples: ["r:mythic", "r>=rare", "r<=uncommon"]
      }
    ]
  },
  {
    id: "printing",
    title: "Printing & metadata",
    entries: [
      {
        syntax: "e",
        aliases: ["s", "set", "edition"],
        description: "Set code.",
        examples: ["e:m21", "set:neo"]
      },
      {
        syntax: "lang",
        aliases: ["language"],
        description: "Printed language code.",
        examples: ["lang:en", "lang:ja"]
      },
      {
        syntax: "layout",
        description:
          "Card layout: normal, transform, modal_dfc, adventure, split, flip, meld, …",
        examples: ["layout:transform", "layout:split"]
      },
      {
        syntax: "exclude",
        description:
          "Filter out groups of cards. exclude:extras drops tokens, emblems, schemes, etc.",
        examples: ["exclude:extras"]
      }
    ]
  },
  {
    id: "together",
    title: "Putting it together",
    intro: "Mix any of the above to build precise searches.",
    entries: [
      {
        description: "Red creatures with power 3 or more.",
        examples: ["c:red t:creature pow>=3"]
      },
      {
        description: "Goblins or elves from War of the Spark.",
        examples: ["(t:goblin or t:elf) e:war"]
      },
      {
        description: "Cheap blue fliers, excluding extras.",
        examples: ["c:blue o:flying mv<=3 -exclude:extras"]
      }
    ]
  }
];

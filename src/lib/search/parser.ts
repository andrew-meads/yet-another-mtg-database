/**
 * Tokenizes a search query string into individual search terms.
 * Handles quoted strings and splits on spaces.
 *
 * A value opening with a slash right after its key (`o:/draw . cards?/`) is a
 * regex value: everything up to the unescaped closing slash is kept verbatim in
 * the token — slashes included — so operators can detect the regex form.
 *
 * Examples:
 *   "c:red t:creature" => ["c:red", "t:creature"]
 *   'o:"draw a card"' => ["o:draw a card"]
 *   "c:red (t:goblin or t:elf)" => ["c:red", "(", "t:goblin", "or", "t:elf", ")"]
 *   "o:/draw . cards?/" => ["o:/draw . cards?/"]
 */
export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";
  let inRegex = false;

  for (let i = 0; i < query.length; i++) {
    const char = query[i];

    // Inside a /regex/ value: copy verbatim (escapes included) until the
    // unescaped closing slash, preserving spaces, quotes, and parentheses.
    if (inRegex) {
      if (char === "\\" && i + 1 < query.length) {
        current += char + query[i + 1];
        i++;
        continue;
      }
      current += char;
      if (char === "/") inRegex = false;
      continue;
    }

    // Handle quotes
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
      continue;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = "";
      continue;
    }

    // If we're in quotes, just add to current token
    if (inQuotes) {
      current += char;
      continue;
    }

    // A slash directly after "key:" opens a regex value. A slash anywhere else
    // (e.g. o:+1/+1) is an ordinary character.
    if (char === "/" && current.endsWith(":")) {
      inRegex = true;
      current += char;
      continue;
    }

    // Handle parentheses as separate tokens
    if (char === "(" || char === ")") {
      if (current.trim()) {
        tokens.push(current.trim());
        current = "";
      }
      tokens.push(char);
      continue;
    }

    // Split on whitespace when not in quotes
    if (char === " " || char === "\t" || char === "\n") {
      if (current.trim()) {
        tokens.push(current.trim());
        current = "";
      }
      continue;
    }

    current += char;
  }

  // Add any remaining token
  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}

/**
 * Parses a search term into its key and value.
 *
 * Examples:
 *   "c:red" => { key: "c", value: "red" }
 *   "mv>=3" => { key: "mv", operator: ">=", value: "3" }
 *   "-t:creature" => { key: "t", value: "creature", negated: true }
 *   "dragon" => { key: null, value: "dragon" } (plain text search)
 */
export interface ParsedTerm {
  key: string | null;
  value: string;
  operator?: string;
  negated: boolean;
}

export function parseTerm(term: string): ParsedTerm {
  // Check for negation
  const negated = term.startsWith("-");
  if (negated) {
    term = term.substring(1);
  }

  // Check for comparison operators (mv>=3, pow>5, etc.)
  const comparisonMatch = term.match(/^([a-z]+)(>=|<=|!=|>|<|=)(.+)$/i);
  if (comparisonMatch) {
    return {
      key: comparisonMatch[1],
      operator: comparisonMatch[2],
      value: comparisonMatch[3],
      negated
    };
  }

  // Check for key:value format
  const colonIndex = term.indexOf(":");
  if (colonIndex > 0) {
    return {
      key: term.substring(0, colonIndex),
      value: term.substring(colonIndex + 1),
      negated
    };
  }

  // Plain text (no key) - used for name search
  return {
    key: null,
    value: term,
    negated
  };
}

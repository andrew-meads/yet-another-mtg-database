/**
 * Tokenizes a search query string into individual search terms.
 * Handles quoted strings and splits on spaces.
 * 
 * Examples:
 *   "c:red t:creature" => ["c:red", "t:creature"]
 *   'o:"draw a card"' => ["o:draw a card"]
 *   "c:red (t:goblin or t:elf)" => ["c:red", "(", "t:goblin", "or", "t:elf", ")"]
 */
export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    const nextChar = query[i + 1];

    // Handle quotes
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
      continue;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
      continue;
    }

    // If we're in quotes, just add to current token
    if (inQuotes) {
      current += char;
      continue;
    }

    // Handle parentheses as separate tokens
    if (char === '(' || char === ')') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      tokens.push(char);
      continue;
    }

    // Split on whitespace when not in quotes
    if (char === ' ' || char === '\t' || char === '\n') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
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
  const negated = term.startsWith('-');
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
  const colonIndex = term.indexOf(':');
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

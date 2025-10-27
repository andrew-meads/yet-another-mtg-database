import { tokenizeQuery, parseTerm, ParsedTerm } from './parser';
import { findOperatorConfig } from './config';
import { escapeRegex } from './helpers';

/**
 * Main query builder that converts a search string into a MongoDB query.
 * 
 * @param queryString - The search query (e.g., "c:red t:creature mv>=3")
 * @returns MongoDB query object
 * 
 * Examples:
 *   buildSearchQuery("c:red") => { colors: { $all: ["R"] } }
 *   buildSearchQuery("t:creature mv>=3") => { $and: [{ type_line: /creature/i }, { cmc: { $gte: 3 } }] }
 *   buildSearchQuery("dragon") => { name: /dragon/i }
 *   buildSearchQuery("t:goblin or t:elf") => { $or: [{ type_line: /goblin/i }, { type_line: /elf/i }] }
 *   buildSearchQuery("c:red (t:goblin or t:elf)") => { $and: [{ colors: { $all: ["R"] } }, { $or: [...] }] }
 */
export function buildSearchQuery(queryString: string): any {
  if (!queryString || queryString.trim() === '') {
    return {};
  }

  const tokens = tokenizeQuery(queryString);
  const result = parseExpression(tokens, 0);
  return result.query || {};
}

/**
 * Parse an expression, handling OR operators and parentheses.
 * Returns the parsed query and the index where parsing stopped.
 */
function parseExpression(tokens: string[], startIndex: number): { query: any; endIndex: number } {
  const andGroups: any[] = [];
  let currentOrGroup: any[] = [];
  let i = startIndex;

  while (i < tokens.length) {
    const token = tokens[i];

    // End of grouped expression
    if (token === ')') {
      break;
    }

    // Handle OR operator
    if (token.toLowerCase() === 'or') {
      i++;
      continue;
    }

    // Handle opening parenthesis - parse nested expression
    if (token === '(') {
      const nested = parseExpression(tokens, i + 1);
      if (nested.query) {
        currentOrGroup.push(nested.query);
      }
      i = nested.endIndex + 1; // Skip past the closing parenthesis
      
      // Check if next token is OR
      if (i < tokens.length && tokens[i].toLowerCase() === 'or') {
        i++;
        continue;
      } else {
        // No OR after this group, so finalize the OR group
        if (currentOrGroup.length > 0) {
          andGroups.push(combineWithOr(currentOrGroup));
          currentOrGroup = [];
        }
      }
      continue;
    }

    // Parse regular term
    const parsed = parseTerm(token);
    const query = buildTermQuery(parsed);

    if (query) {
      currentOrGroup.push(query);
    }

    i++;

    // Check if next token is OR
    if (i < tokens.length && tokens[i].toLowerCase() === 'or') {
      // Continue building the OR group
      continue;
    } else {
      // No OR, so finalize this OR group
      if (currentOrGroup.length > 0) {
        andGroups.push(combineWithOr(currentOrGroup));
        currentOrGroup = [];
      }
    }
  }

  // Finalize any remaining OR group
  if (currentOrGroup.length > 0) {
    andGroups.push(combineWithOr(currentOrGroup));
  }

  // Combine all AND groups
  const finalQuery = combineWithAnd(andGroups);

  return {
    query: finalQuery,
    endIndex: i
  };
}

/**
 * Combine queries with OR operator
 */
function combineWithOr(queries: any[]): any {
  if (queries.length === 0) {
    return null;
  } else if (queries.length === 1) {
    return queries[0];
  } else {
    return { $or: queries };
  }
}

/**
 * Combine queries with AND operator
 */
function combineWithAnd(queries: any[]): any {
  const filtered = queries.filter(q => q !== null);
  
  if (filtered.length === 0) {
    return {};
  } else if (filtered.length === 1) {
    return filtered[0];
  } else {
    return { $and: filtered };
  }
}

/**
 * Build a MongoDB query for a single parsed term
 */
function buildTermQuery(term: ParsedTerm): any {
  let query: any;
  
  // If no key specified, treat as name search
  if (!term.key) {
    query = { name: new RegExp(escapeRegex(term.value), 'i') };
  } else {
    // Find the operator config
    const config = findOperatorConfig(term.key);
    
    if (!config) {
      // Unknown operator, ignore
      return null;
    }
    
    // Validate if validator exists
    if (config.validate && !config.validate(term.value)) {
      return null;
    }
    
    // Build the query using the config
    query = config.buildQuery(term.value, term.operator);
  }
  
  // Handle negation
  if (term.negated && query) {
    return { $nor: [query] };
  }
  
  return query;
}

/**
 * Helper to parse and build a query in one step.
 * This is the main function you'll use in your API route.
 */
export function parseSearchQuery(queryString: string | null | undefined): any {
  if (!queryString) {
    return {};
  }
  
  return buildSearchQuery(queryString);
}

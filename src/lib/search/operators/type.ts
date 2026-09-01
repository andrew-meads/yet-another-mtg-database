import { escapeRegex, parseRegexValue } from "../helpers";
import { SearchOperatorConfig } from "../types";

/**
 * Type search: t:creature, t:instant, t:legendary
 *
 * A slash-delimited value is matched as a regular expression instead of literal
 * text (Scryfall-style): t:/^legendary creature/ — case-insensitive, with \/
 * escaping a literal slash; invalid patterns fall back to a literal match.
 */
export const typeOperator: SearchOperatorConfig = {
  aliases: ["t", "type"],
  buildQuery: (value) => {
    return { type_line: parseRegexValue(value) ?? new RegExp(escapeRegex(value), "i") };
  }
};

import { escapeRegex, parseRegexValue } from "../helpers";
import { SearchOperatorConfig } from "../types";

/**
 * Oracle text search: o:flying, o:"draw a card"
 *
 * A slash-delimited value is matched as a regular expression instead of literal
 * text (Scryfall-style): o:/draw . cards?/ — case-insensitive, with \/ escaping
 * a literal slash. An invalid or unterminated pattern falls back to a literal
 * match of the raw value (the engine degrades rather than erroring).
 */
export const oracleOperator: SearchOperatorConfig = {
  aliases: ["o", "oracle"],
  buildQuery: (value) => {
    const regex = parseRegexValue(value);
    if (regex) {
      return { oracle_text: regex };
    }
    return { oracle_text: new RegExp(escapeRegex(value), "i") };
  }
};

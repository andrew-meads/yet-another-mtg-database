import { escapeRegex, parseRegexValue, withCardFaces } from "../helpers";
import { SearchOperatorConfig } from "../types";

/**
 * Oracle text search: o:flying, o:"draw a card"
 *
 * Matches the card's oracle text OR any face's oracle text (multi-faced cards
 * keep their rules text on `card_faces[]`).
 *
 * A slash-delimited value is matched as a regular expression instead of literal
 * text (Scryfall-style): o:/draw . cards?/ — case-insensitive, with \/ escaping
 * a literal slash. An invalid or unterminated pattern falls back to a literal
 * match of the raw value (the engine degrades rather than erroring).
 */
export const oracleOperator: SearchOperatorConfig = {
  aliases: ["o", "oracle"],
  buildQuery: (value) => {
    const regex = parseRegexValue(value) ?? new RegExp(escapeRegex(value), "i");
    return withCardFaces("oracle_text", regex);
  }
};

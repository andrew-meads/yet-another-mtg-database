import { escapeRegex, parseRegexValue, withCardFaces } from "../helpers";
import { SearchOperatorConfig } from "../types";

/**
 * Type search: t:creature, t:instant, t:legendary
 *
 * Matches the card's type line OR any face's type line (the top-level line of a
 * multi-faced card is the combined "Front // Back" string, so face-level
 * matching keeps anchored patterns like t:/^legendary/ honest for back faces).
 *
 * A slash-delimited value is matched as a regular expression instead of literal
 * text (Scryfall-style): t:/^legendary creature/ — case-insensitive, with \/
 * escaping a literal slash; invalid patterns fall back to a literal match.
 */
export const typeOperator: SearchOperatorConfig = {
  aliases: ["t", "type"],
  buildQuery: (value) => {
    const regex = parseRegexValue(value) ?? new RegExp(escapeRegex(value), "i");
    return withCardFaces("type_line", regex);
  }
};

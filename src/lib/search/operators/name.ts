import { escapeRegex, parseRegexValue } from "../helpers";
import { SearchOperatorConfig } from "../types";

/**
 * Name search: name:lightning, name:"black lotus"
 * Also matches flavor_name (e.g., Godzilla series cards)
 *
 * A slash-delimited value is matched as a regular expression instead of literal
 * text (Scryfall-style): name:/^goblin .* boss$/ — case-insensitive, with \/
 * escaping a literal slash; invalid patterns fall back to a literal match.
 */
export const nameOperator: SearchOperatorConfig = {
  aliases: ["name"],
  buildQuery: (value) => {
    const regex = parseRegexValue(value) ?? new RegExp(escapeRegex(value), "i");
    return {
      $or: [{ name: regex }, { flavor_name: regex }]
    };
  }
};

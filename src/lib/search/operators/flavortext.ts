import { escapeRegex, parseRegexValue, withCardFaces } from "../helpers";
import { SearchOperatorConfig } from "../types";

/**
 * Flavor text search: ft:"squirrels", ft:/jaya/ — matches the card's flavor
 * text or any face's. Slash-delimited values match as regular expressions,
 * like the other text operators. (Note: `flavor`/`fn` is the *flavor name*
 * operator; this one is the italic flavor text.)
 */
export const flavortextOperator: SearchOperatorConfig = {
  aliases: ["ft", "flavortext"],
  buildQuery: (value) => {
    const regex = parseRegexValue(value) ?? new RegExp(escapeRegex(value), "i");
    return withCardFaces("flavor_text", regex);
  }
};

import { EFFECTIVE_COLORS_EXPR, parseColors } from "../helpers";
import { SearchOperatorConfig } from "../types";

/**
 * Color search: c:red, c:ur, c:azorius
 *
 * A card's colors are the UNION of its top-level `colors` and every face's
 * `colors` — transform/modal-DFC cards store colors only on their faces (the
 * top-level array is empty), so all comparisons run as `$expr` set operations
 * over that union. Semantics: `:`/`>=` = contains at least, `=` = exactly,
 * `<=` = at most (subset; includes colorless), `c:c` = colorless.
 */
export const colorOperator: SearchOperatorConfig = {
  aliases: ["c", "color"],
  buildQuery: (value, operator) => {
    const colors = parseColors(value);

    if (colors.length === 0) {
      // Colorless: no colors on the card or any of its faces.
      return { $expr: { $eq: [{ $size: EFFECTIVE_COLORS_EXPR }, 0] } };
    }

    // =: exact color match (must have exactly these colors, no more, no less)
    if (operator === "=") {
      return { $expr: { $setEquals: [EFFECTIVE_COLORS_EXPR, colors] } };
    }

    // <=: at most these colors (subset; colorless passes)
    if (operator === "<=") {
      return { $expr: { $setIsSubset: [EFFECTIVE_COLORS_EXPR, colors] } };
    }

    // Default / `:` / `>=`: card must have ALL specified colors (can have more)
    return { $expr: { $setIsSubset: [colors, EFFECTIVE_COLORS_EXPR] } };
  }
};

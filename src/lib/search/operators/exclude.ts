import { SearchOperatorConfig } from "../types";

const INVALID_LAYOUTS = [
  "battle",
  "planar",
  "scheme",
  "vanguard",
  "token",
  "double_faced_token",
  "emblem"
];

/**
 * Excludes: exclude:extras
 */
export const excludeOperator: SearchOperatorConfig = {
  aliases: ["exclude"],
  buildQuery: (value) => {
    if (value !== "extras") return null;

    return { 
      layout: { $nin: INVALID_LAYOUTS }, 
      type_line: { $ne: "Card" } 
    };
  }
};

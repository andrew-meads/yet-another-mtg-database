import { escapeRegex } from "../helpers";
import { SearchOperatorConfig } from "../types";

/**
 * Set: matches the exact set code (e:war, s:m21, set:neo) or a full/partial
 * set name, case-insensitively (set:"throne of eldraine", e:eldraine)
 */
export const setOperator: SearchOperatorConfig = {
  aliases: ["e", "s", "set", "edition"],
  buildQuery: (value) => {
    return {
      $or: [{ set: value.toLowerCase() }, { set_name: new RegExp(escapeRegex(value), "i") }]
    };
  }
};

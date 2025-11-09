import { escapeRegex } from "../helpers";
import { SearchOperatorConfig } from "../types";

/**
 * Name search: name:lightning, name:"black lotus"
 * Also matches flavor_name (e.g., Godzilla series cards)
 */
export const nameOperator: SearchOperatorConfig = {
  aliases: ["name"],
  buildQuery: (value) => {
    const regex = new RegExp(escapeRegex(value), "i");
    return {
      $or: [{ name: regex }, { flavor_name: regex }]
    };
  }
};

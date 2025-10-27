import { SearchOperatorConfig } from "../types";

/**
 * Language: lang:en, lang:ja, lang:es
 */
export const langOperator: SearchOperatorConfig = {
  aliases: ["lang", "language"],
  buildQuery: (value) => {
    return { lang: value.toLowerCase() };
  }
};

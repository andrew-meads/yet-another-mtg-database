/* eslint-disable @typescript-eslint/no-explicit-any */
import { SearchOperatorConfig } from "../types";

/**
 * Card-property predicates: is:mdfc, is:transform, is:vanilla, is:permanent, …
 * Unknown values are ignored (the term degrades, matching the engine's
 * behavior for unknown operators).
 */
const IS_PREDICATES: Record<string, any> = {
  /** Any double-faced card. */
  dfc: { layout: { $in: ["transform", "modal_dfc", "meld"] } },
  mdfc: { layout: "modal_dfc" },
  transform: { layout: "transform" },
  split: { layout: "split" },
  adventure: { layout: "adventure" },
  flip: { layout: "flip" },
  meld: { layout: "meld" },
  /** A creature with no rules text (layout-gated so faceless DFC parents don't match). */
  vanilla: {
    layout: "normal",
    type_line: /creature/i,
    $or: [{ oracle_text: "" }, { oracle_text: { $exists: false } }]
  },
  permanent: { type_line: /artifact|creature|enchantment|land|planeswalker|battle/i },
  spell: { type_line: /instant|sorcery/i }
};

/** Exported for docs/tests: the accepted is: values. */
export const IS_PREDICATE_NAMES = Object.keys(IS_PREDICATES);

export const isOperator: SearchOperatorConfig = {
  aliases: ["is"],
  buildQuery: (value) => {
    return IS_PREDICATES[value.toLowerCase()] ?? null;
  }
};

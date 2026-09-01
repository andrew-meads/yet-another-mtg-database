import { ToolContext } from "./shared";
import { makeReadDeckTool } from "./readDeck";
import { makeReadCollectionTool } from "./readCollection";
import { makeSearchCardsTool, makeSearchMyCardsTool } from "./searchCards";
import { makeGetCardDetailsTool } from "./getCardDetails";
import { makeManaBaseStatsTool } from "./manaBaseStats";
import { makeGetRulingsTool } from "./getRulings";
import { makeLookupRuleTool } from "./lookupRule";

export type { ToolContext } from "./shared";

/**
 * Build the full read-only tool set for a session user. Every tool closes over
 * the user id (every Mongo query is owner-scoped) and returns errors in-band —
 * none of them can modify anything. Personas pick a subset by key.
 */
export function buildAiTools(ctx: ToolContext) {
  return {
    readDeck: makeReadDeckTool(ctx),
    readCollection: makeReadCollectionTool(ctx),
    searchCards: makeSearchCardsTool(ctx),
    searchMyCards: makeSearchMyCardsTool(ctx),
    getCardDetails: makeGetCardDetailsTool(ctx),
    manaBaseStats: makeManaBaseStatsTool(ctx),
    getRulings: makeGetRulingsTool(ctx),
    lookupRule: makeLookupRuleTool(ctx)
  };
}

export type AiToolName = keyof ReturnType<typeof buildAiTools>;

/** Build only the named subset of tools (a persona's tool list). */
export function buildAiToolSubset(ctx: ToolContext, names: readonly AiToolName[]) {
  const all = buildAiTools(ctx);
  return Object.fromEntries(names.map((name) => [name, all[name]]));
}

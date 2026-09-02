import { ToolContext } from "./shared";
import { makeReadDeckTool } from "./readDeck";
import { makeReadCollectionTool } from "./readCollection";
import { makeSearchCardsTool, makeSearchMyCardsTool } from "./searchCards";
import { makeGetCardDetailsTool } from "./getCardDetails";
import { makeManaBaseStatsTool } from "./manaBaseStats";
import { makeGetRulingsTool } from "./getRulings";
import { makeLookupRuleTool } from "./lookupRule";
import { makeFindCombosTool } from "./findCombos";
import { makeProposeDeckChangesTool } from "./proposeDeckChanges";

export type { ToolContext } from "./shared";

/**
 * Build the full tool set for a session user. Every tool closes over the user
 * id (every Mongo query is owner-scoped) and returns errors in-band — and none
 * of them can modify anything: even proposeDeckChanges only validates and
 * echoes a proposal (the user applies it client-side). Personas pick a subset
 * by key.
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
    lookupRule: makeLookupRuleTool(ctx),
    findCombos: makeFindCombosTool(ctx),
    proposeDeckChanges: makeProposeDeckChangesTool(ctx)
  };
}

export type AiToolName = keyof ReturnType<typeof buildAiTools>;

/** Build only the named subset of tools (a persona's tool list). */
export function buildAiToolSubset(ctx: ToolContext, names: readonly AiToolName[]) {
  const all = buildAiTools(ctx);
  return Object.fromEntries(names.map((name) => [name, all[name]]));
}

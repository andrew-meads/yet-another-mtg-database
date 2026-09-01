import { deckAdvisorPersona } from "./deckAdvisor";
import type { AiAgentPersona } from "./types";

export type { AiAgentPersona, ChatAgentContext } from "./types";

/**
 * Registry of chat agent personas, keyed by the `agentId` the client sends to
 * POST /api/ai/chat. (The tool-less search translator lives separately in
 * ./searchTranslator.ts — it is a one-shot call, not a chat persona.)
 */
export const aiAgents: Record<string, AiAgentPersona> = {
  [deckAdvisorPersona.id]: deckAdvisorPersona
};

export function getAgentPersona(agentId: string): AiAgentPersona | null {
  return aiAgents[agentId] ?? null;
}

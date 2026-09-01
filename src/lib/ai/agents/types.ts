import type { AiToolName } from "@/lib/ai/tools";

/** Per-request context the client sends with a chat: what the user is viewing. */
export interface ChatAgentContext {
  deckId?: string;
  collectionId?: string;
}

/**
 * An agent persona: a system prompt, a tool subset, and generation params.
 * One persona per feature — per-feature tuning without a graph framework.
 */
export interface AiAgentPersona {
  id: string;
  /** Human-readable name (used by the chat panel header). */
  name: string;
  /** The subset of the tool registry this persona may call. */
  toolNames: readonly AiToolName[];
  /** Output-token ceiling per model call (generous: reasoning models spend tokens thinking). */
  maxOutputTokens: number;
  /** Tool-loop cap — maximum model steps per user turn. */
  stepLimit: number;
  buildSystemPrompt(context: ChatAgentContext): string;
}

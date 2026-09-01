import { Types } from "mongoose";
import { CardData } from "@/db/schema";
import { MtgCard } from "@/types/MtgCard";
import { escapeRegex } from "@/lib/search/helpers";

/**
 * Shared plumbing for the AI tool layer. Every tool is a factory closing over
 * the session user id, wraps server helpers directly (never HTTP self-calls),
 * and NEVER throws out of execute — errors are returned in-band as
 * `{ error: string }` so the model can react instead of the stream dying.
 */

/** Every tool factory receives the session user. */
export interface ToolContext {
  userId: string;
}

/** Standard in-band tool error shape. */
export interface ToolError {
  error: string;
}

/** Cap on cards returned by list-shaped tools (totals are always reported). */
export const TOOL_RESULT_CARD_CAP = 20;

/**
 * Mongo projection for LLM-facing card loads — the source fields of
 * `slimCardForLlm` (src/lib/ai/slim.ts). No images.
 */
export const LLM_CARD_PROJECTION = {
  _id: 0,
  id: 1,
  name: 1,
  mana_cost: 1,
  cmc: 1,
  type_line: 1,
  oracle_text: 1,
  colors: 1,
  color_identity: 1,
  produced_mana: 1,
  keywords: 1,
  power: 1,
  toughness: 1,
  loyalty: 1,
  rarity: 1,
  set: 1,
  released_at: 1,
  "card_faces.name": 1,
  "card_faces.mana_cost": 1,
  "card_faces.type_line": 1,
  "card_faces.oracle_text": 1,
  "card_faces.power": 1,
  "card_faces.toughness": 1,
  "card_faces.loyalty": 1,
  "card_faces.colors": 1
} as const;

/** Whether a string is a well-formed Mongo ObjectId (tools get model input). */
export function isValidObjectId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

/**
 * Resolve a card by (exact, case-insensitive) name — matching the card name,
 * flavor name, or any face name. Newest printing wins so text reflects current
 * oracle wording. Returns null when unknown.
 */
export async function findCardByName(name: string): Promise<MtgCard | null> {
  const rx = new RegExp(`^${escapeRegex(name.trim())}$`, "i");
  const card = await CardData.findOne(
    { $or: [{ name: rx }, { flavor_name: rx }, { "card_faces.name": rx }] },
    LLM_CARD_PROJECTION
  )
    .sort({ released_at: -1 })
    .lean();
  return (card as MtgCard | null) ?? null;
}

/**
 * Wrap a tool execute body so it can never throw: any error becomes an in-band
 * `{ error }` result (and is logged server-side for diagnostics).
 */
export function safeExecute<TInput, TResult>(
  toolName: string,
  body: (input: TInput) => Promise<TResult>
): (input: TInput) => Promise<TResult | ToolError> {
  return async (input: TInput) => {
    try {
      return await body(input);
    } catch (error) {
      console.error(`AI tool ${toolName} failed:`, error);
      const message = error instanceof Error ? error.message : "unavailable";
      return { error: `${toolName} is unavailable: ${message}` };
    }
  };
}

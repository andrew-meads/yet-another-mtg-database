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
 * The system's native card language: printings created by the app (e.g.
 * ephemeral copies from an applied proposal) should use a printing in this
 * language when one exists.
 */
export const NATIVE_CARD_LANG = "en";

/**
 * Resolve a card by exact (case-insensitive) name to a printing in the
 * system's native language — newest native printing first, falling back to
 * the newest printing in any language for cards never printed natively.
 */
export async function findNativePrintingByName(name: string): Promise<MtgCard | null> {
  const rx = new RegExp(`^${escapeRegex(name.trim())}$`, "i");
  const nameFilter = { $or: [{ name: rx }, { flavor_name: rx }, { "card_faces.name": rx }] };
  const native = await CardData.findOne(
    { $and: [nameFilter, { lang: NATIVE_CARD_LANG }] },
    LLM_CARD_PROJECTION
  )
    .sort({ released_at: -1 })
    .lean();
  if (native) return native as unknown as MtgCard;
  return findCardByName(name);
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
 *
 * Every call logs one `[ai] tool …` line (name, duration, input, result size
 * or in-band error) so a hung or slow tool is visible in the server console.
 * Set `AI_CHAT_DEBUG=true` to also dump each full result JSON.
 */
export function safeExecute<TInput, TResult>(
  toolName: string,
  body: (input: TInput) => Promise<TResult>
): (input: TInput) => Promise<TResult | ToolError> {
  return async (input: TInput) => {
    const startedAt = Date.now();
    console.log(`[ai] tool ${toolName} called: ${JSON.stringify(input)}`);
    try {
      const result = await body(input);
      const ms = Date.now() - startedAt;
      const inBandError = (result as { error?: unknown } | null)?.error;
      const summary =
        typeof inBandError === "string"
          ? `error: ${inBandError}`
          : `ok, ${JSON.stringify(result)?.length ?? 0} bytes`;
      console.log(`[ai] tool ${toolName} finished in ${ms}ms → ${summary}`);
      if (process.env.AI_CHAT_DEBUG === "true") {
        console.log(`[ai] tool ${toolName} result:`, JSON.stringify(result, null, 2));
      }
      return result;
    } catch (error) {
      console.error(`[ai] tool ${toolName} threw after ${Date.now() - startedAt}ms:`, error);
      const message = error instanceof Error ? error.message : "unavailable";
      return { error: `${toolName} is unavailable: ${message}` };
    }
  };
}

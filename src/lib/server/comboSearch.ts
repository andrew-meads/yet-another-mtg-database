import { SCRYFALL_HEADERS } from "@/lib/scryfall";

/**
 * Combo lookup via the Commander Spellbook API (open-source backend:
 * github.com/SpaceCowMedia/commander-spellbook-backend). POSTs a decklist to
 * /find-my-combos and slims the (very verbose) response hard: combo id, card
 * names, what it produces, and a capped step description. No cache — requests
 * are decklist-specific and cheap.
 */

const COMBO_FETCH_TIMEOUT_MS = 10_000;

/** Caps keep the LLM payload bounded even for combo-dense decks. */
export const INCLUDED_COMBO_CAP = 20;
export const ALMOST_COMBO_CAP = 10;
const DESCRIPTION_CAP = 600;

export interface SlimCombo {
  id: string;
  /** Public combo page, citable in answers. */
  url: string;
  cards: string[];
  produces: string[];
  /** Step-by-step description (truncated). Included combos only. */
  description?: string;
  /** Cards the deck is missing (almost-included combos only). */
  missing?: string[];
}

export interface SlimComboResults {
  /** Combos fully present in the deck. */
  included: SlimCombo[];
  /** Combos one-or-more cards away. */
  almostIncluded: SlimCombo[];
  totalIncluded: number;
  totalAlmostIncluded: number;
}

interface RawComboVariant {
  id?: string | number;
  uses?: Array<{ card?: { name?: string } }>;
  produces?: Array<{ feature?: { name?: string } }>;
  description?: string;
}

function baseUrl(): string {
  return process.env.COMMANDER_SPELLBOOK_API_BASE_URL || "https://backend.commanderspellbook.com";
}

function comboCards(variant: RawComboVariant): string[] {
  return (variant.uses ?? [])
    .map((u) => u.card?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

function slimVariant(variant: RawComboVariant): SlimCombo {
  const id = String(variant.id ?? "");
  return {
    id,
    url: `https://commanderspellbook.com/combo/${id}/`,
    cards: comboCards(variant),
    produces: (variant.produces ?? [])
      .map((p) => p.feature?.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0)
  };
}

/**
 * Slim a raw find-my-combos response. Pure — unit-tested against a fixture.
 * `deckNames` (lowercased) identifies which cards an almost-included combo is
 * missing.
 */
export function slimComboResponse(body: unknown, deckNames: string[]): SlimComboResults {
  const results = ((body ?? {}) as { results?: Record<string, unknown> }).results ?? {};
  const inDeck = new Set(deckNames.map((n) => n.toLowerCase()));

  const rawIncluded = Array.isArray(results.included) ? (results.included as RawComboVariant[]) : [];
  const rawAlmost = Array.isArray(results.almostIncluded)
    ? (results.almostIncluded as RawComboVariant[])
    : [];

  const included = rawIncluded.slice(0, INCLUDED_COMBO_CAP).map((v) => {
    const slim = slimVariant(v);
    if (typeof v.description === "string" && v.description.length > 0) {
      slim.description =
        v.description.length > DESCRIPTION_CAP
          ? `${v.description.slice(0, DESCRIPTION_CAP)}…`
          : v.description;
    }
    return slim;
  });

  const almostIncluded = rawAlmost.slice(0, ALMOST_COMBO_CAP).map((v) => {
    const slim = slimVariant(v);
    slim.missing = slim.cards.filter((c) => !inDeck.has(c.toLowerCase()));
    return slim;
  });

  return {
    included,
    almostIncluded,
    totalIncluded: rawIncluded.length,
    totalAlmostIncluded: rawAlmost.length
  };
}

/**
 * Find combos contained in (or nearly contained in) a list of card names.
 *
 * @throws on network/timeout/API errors — callers surface an in-band tool error.
 */
export async function findCombosForNames(names: string[]): Promise<SlimComboResults> {
  const response = await fetch(`${baseUrl()}/find-my-combos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": SCRYFALL_HEADERS["User-Agent"],
      Accept: "application/json"
    },
    body: JSON.stringify({
      main: names.map((card) => ({ card, quantity: 1 })),
      commanders: []
    }),
    signal: AbortSignal.timeout(COMBO_FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`Commander Spellbook returned ${response.status}`);
  }
  return slimComboResponse(await response.json(), names);
}

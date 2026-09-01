import { MtgCard } from "@/types/MtgCard";
import { CardPrices } from "@/types/CardPrice";

/**
 * LLM-facing card shapes: only the fields a deck advisor reasons about, with no
 * image URLs and undefined-valued keys dropped so serialized tool results stay
 * small. Distinct from SlimMtgCard (the client render projection) — this one
 * keeps colors/produced_mana/keywords and drops images entirely.
 */

export interface LlmCardFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
}

export interface LlmCard {
  id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  produced_mana?: string[];
  keywords?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  rarity: string;
  set: string;
  card_faces?: LlmCardFace[];
  prices?: CardPrices;
}

/** Remove keys whose value is undefined or an empty array (in place-ish copy). */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as T;
}

/**
 * Project a card (full MtgCard or anything structurally containing its fields)
 * down to the LLM-facing shape. Multi-faced cards keep their per-face text —
 * transform/MDFC/adventure cards carry rules text and colors on `card_faces`,
 * so dropping faces would blind the model to half the card.
 */
export function slimCardForLlm(card: MtgCard, prices?: CardPrices): LlmCard {
  return compact({
    id: card.id,
    name: card.name,
    mana_cost: card.mana_cost || undefined,
    cmc: card.cmc,
    type_line: card.type_line,
    oracle_text: card.oracle_text || undefined,
    colors: card.colors,
    color_identity: card.color_identity,
    produced_mana: card.produced_mana,
    keywords: card.keywords,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    rarity: card.rarity,
    set: card.set,
    card_faces: card.card_faces?.map((face) =>
      compact({
        name: face.name,
        mana_cost: face.mana_cost || undefined,
        type_line: face.type_line,
        oracle_text: face.oracle_text || undefined,
        power: face.power,
        toughness: face.toughness,
        loyalty: face.loyalty,
        colors: face.colors
      })
    ),
    prices
  }) as LlmCard;
}

import { SlimMtgCard } from "./MtgCard";
import { CardCondition, CardFinish } from "@/lib/cardAttributes";
import { CopyPrice } from "./CardPrice";

/**
 * A single physical card copy.
 *
 * A physical card belongs to at most one collection (`collectionId`) and is
 * optionally assigned to at most one deck (`deckId`). These back-references are
 * the source of truth for membership. A card with `collectionId === null` is
 * **ephemeral**: it lives only inside its deck and is deleted when removed from it.
 *
 * `finish` and `condition` are optional: an absent value means the default
 * (`nonfoil` / `NM`), so pre-existing documents need no backfill — read them via
 * `effectiveFinish` / `effectiveCondition` from `src/lib/cardAttributes.ts`.
 */
export interface PhysicalCard {
  _id: string;
  owner: string;
  /** Scryfall id of the card (references CardData.id) */
  cardId: string;
  /** Owning collection, or null/undefined for an ephemeral (deck-only) card. */
  collectionId?: string | null;
  deckId?: string | null;
  notes?: string;
  tags?: string[];
  /** Foil treatment of this copy; absent = non-foil. */
  finish?: CardFinish;
  /** Wear grade of this copy; absent = Near Mint. */
  condition?: CardCondition;
  /** Last price fetched for this copy's finish + condition; absent = never fetched. */
  price?: CopyPrice;
}

/**
 * The per-copy fields a caller can set when creating new copies (search-page
 * add-meta bar, drag items, "add another copy"). Absent/undefined = default.
 */
export type NewCopyMeta = Pick<PhysicalCard, "notes" | "tags" | "finish" | "condition">;

/**
 * A physical card joined with its Scryfall card data and cross-membership labels
 * used for badges (which deck a collection-card is in, and vice versa).
 */
export interface DetailedPhysicalCard {
  _id: string;
  card: SlimMtgCard;
  /** Owning collection, or null for an ephemeral (deck-only) card. */
  collectionId: string | null;
  deckId?: string | null;
  notes?: string;
  tags?: string[];
  /** Foil treatment of this copy; absent = non-foil. */
  finish?: CardFinish;
  /** Wear grade of this copy; absent = Near Mint. */
  condition?: CardCondition;
  /** Last price fetched for this copy's finish + condition; absent = never fetched. */
  price?: CopyPrice;
  /** True when this is an ephemeral (deck-only) card with no collection. */
  isEphemeral?: boolean;
  /** Name of the collection this card belongs to (for the deck view badge) */
  collectionName?: string;
  /** Name of the deck this card is assigned to, if any (for the collection table badge) */
  deckName?: string;
}

/**
 * The wire form of a DetailedPhysicalCard: the card data is NOT embedded — the
 * entry carries the Scryfall `cardId` and the response ships a single
 * deduplicated `CardDataMap` alongside. The client re-joins them back into
 * DetailedPhysicalCard objects (see joinCardEntries in src/lib/cardEntries.ts),
 * so duplicate copies share one card object over the wire and in memory.
 */
export type DetailedPhysicalCardEntry = Omit<DetailedPhysicalCard, "card"> & {
  /** Scryfall id of the card; key into the response's CardDataMap. */
  cardId: string;
};

/** Deduplicated card data keyed by Scryfall id, shipped once per response. */
export type CardDataMap = Record<string, SlimMtgCard>;

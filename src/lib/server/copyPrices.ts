import { Types } from "mongoose";
import { CardData, PhysicalCardModel } from "@/db/schema";
import { CopyPrice } from "@/types/CardPrice";
import { PriceSourceId } from "@/lib/priceSources";
import {
  CardCondition,
  CardFinish,
  effectiveCondition,
  effectiveFinish,
  isProxyCopy
} from "@/lib/cardAttributes";
import { CopyPriceGroup, copyPriceKey, resolveCopyPrices } from "@/lib/server/priceSources";
import { SourceCard } from "@/lib/server/priceSources/types";
import { DEFAULT_SOURCE_ORDER } from "@/lib/server/cardPrices";

/** A manual copy refresh is per row; keep the upstream cost bounded. */
export const MAX_COPY_REFRESH = 100;

export interface CopyRefreshResult {
  /** The new price record per physical card id (only the cards that were written). */
  prices: Record<string, CopyPrice>;
  /** Ids that were not the user's (or don't exist) and were ignored. */
  unknown: string[];
  /** Ids of proxies (the "Proxy" tag): worth $0 by rule, so no source is consulted. */
  proxies: string[];
}

/**
 * Fetch prices for the given physical cards according to EACH copy's finish
 * and condition (grouped so identical copies are looked up once), through the
 * user's sources in priority order, and store the result on each physical
 * card as its `price` record. Copies tagged "Proxy" are skipped outright (a
 * proxy is $0 by rule; the UI derives that from the tag). Copies no source
 * could price are stored with a null price (fetched, unpriced) — unless a
 * source failed, in which case they are left untouched so an outage never
 * masquerades as "no price".
 *
 * @throws when a source failed and no copy could be priced (route → 502).
 */
export async function refreshCopyPrices(
  userId: string,
  physicalCardIds: string[],
  order: PriceSourceId[] = DEFAULT_SOURCE_ORDER
): Promise<CopyRefreshResult> {
  const validIds = [...new Set(physicalCardIds)].filter((id) => Types.ObjectId.isValid(id));
  const all = await PhysicalCardModel.find(
    { _id: { $in: validIds }, owner: new Types.ObjectId(userId) },
    { cardId: 1, finish: 1, condition: 1, tags: 1 }
  ).lean();
  const foundIds = new Set(all.map((c) => String(c._id)));
  const unknown = physicalCardIds.filter((id) => !foundIds.has(id));
  const proxies = all.filter((c) => isProxyCopy(c.tags)).map((c) => String(c._id));
  const copies = all.filter((c) => !isProxyCopy(c.tags));
  if (copies.length === 0) return { prices: {}, unknown, proxies };

  const cardIds = [...new Set(copies.map((c) => c.cardId))];
  const cards = (await CardData.find(
    { id: { $in: cardIds } },
    { _id: 0, id: 1, set: 1, tcgplayer_id: 1, tcgplayer_etched_id: 1 }
  ).lean()) as unknown as SourceCard[];
  const cardById = new Map(cards.map((c) => [c.id, c]));

  // Group copies by (finish, condition), each group listing its distinct cards.
  const groups = new Map<string, CopyPriceGroup>();
  for (const copy of copies) {
    const card = cardById.get(copy.cardId);
    if (!card) continue;
    const finish = effectiveFinish(copy.finish);
    const condition = effectiveCondition(copy.condition);
    const key = `${finish}|${condition}`;
    const group = groups.get(key) ?? { finish, condition, cards: [] };
    if (!group.cards.some((c) => c.id === card.id)) group.cards.push(card);
    groups.set(key, group);
  }

  const { prices: resolved, failures } = await resolveCopyPrices([...groups.values()], order);
  const now = new Date();
  type StoredCopyPrice = CopyPrice & { updatedAt: Date };
  const prices: Record<string, CopyPrice> = {};
  const writes: Array<{ id: string; price: StoredCopyPrice }> = [];

  for (const copy of copies) {
    if (!cardById.has(copy.cardId)) continue;
    const finish: CardFinish = effectiveFinish(copy.finish);
    const condition: CardCondition = effectiveCondition(copy.condition);
    const answer = resolved[copyPriceKey(copy.cardId, finish, condition)];
    if (!answer && failures.length > 0) continue; // outage: leave the copy as it was
    const price: StoredCopyPrice = {
      usd: answer?.usd ?? null,
      source: answer?.source,
      finish,
      condition,
      conditionMatched: answer?.matched ?? false,
      updatedAt: now
    };
    writes.push({ id: String(copy._id), price });
    prices[String(copy._id)] = price;
  }

  if (writes.length > 0) {
    await PhysicalCardModel.bulkWrite(
      writes.map(({ id, price }) => ({
        updateOne: { filter: { _id: new Types.ObjectId(id) }, update: { $set: { price } } }
      })),
      { ordered: false }
    );
  }
  return { prices, unknown, proxies };
}

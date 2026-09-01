import { CardRulingModel } from "@/db/schema";
import { scryfallFetch } from "@/lib/scryfall";

/**
 * Rulings older than this are refreshed from Scryfall. Rulings only change when
 * new sets release, so a week keeps us comfortably current.
 */
export const RULING_STALENESS_MS = 7 * 24 * 60 * 60 * 1000;

export interface CardRuling {
  source: string;
  published_at: string;
  comment: string;
}

/** Whether a cached record's timestamp is still within the staleness window. */
export function isRulingFresh(updatedAt: Date | undefined, now = Date.now()): boolean {
  if (!updatedAt) return false;
  return now - updatedAt.getTime() < RULING_STALENESS_MS;
}

/**
 * Pull the ruling fields off a raw Scryfall rulings-list response, defaulting
 * missing fields. Pure — safe to unit-test without a DB or network.
 */
export function extractRulings(body: {
  data?: Array<{ source?: string; published_at?: string; comment?: string }>;
}): CardRuling[] {
  return (body.data ?? [])
    .filter((r) => typeof r.comment === "string" && r.comment.length > 0)
    .map((r) => ({
      source: r.source ?? "",
      published_at: r.published_at ?? "",
      comment: r.comment as string
    }));
}

/**
 * Resolve the rulings for a card (by Scryfall id), serving a fresh cached copy
 * (< 7 days old) or fetching from Scryfall's GET /cards/{id}/rulings and
 * upserting the result. A card with no rulings caches an empty list.
 *
 * @throws if the Scryfall request fails (non-ok / network error) with no cached
 * fallback — callers surface an in-band tool error.
 */
export async function getCardRulings(cardId: string): Promise<CardRuling[]> {
  const cached = await CardRulingModel.findOne({ cardId });
  if (cached && isRulingFresh(cached.updatedAt)) return cached.rulings;

  let rulings: CardRuling[];
  try {
    const url = `${process.env.SCRYFALL_API_BASE_URL}/cards/${encodeURIComponent(cardId)}/rulings`;
    const response = await scryfallFetch(url);
    if (!response.ok) throw new Error(`Scryfall rulings returned ${response.status}`);
    rulings = extractRulings(await response.json());
  } catch (error) {
    // Serve a stale copy over failing outright when we have one.
    if (cached) return cached.rulings;
    throw error;
  }

  await CardRulingModel.findOneAndUpdate({ cardId }, { rulings }, { upsert: true });
  return rulings;
}

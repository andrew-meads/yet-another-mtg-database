import { Types } from "mongoose";
import { CardData } from "@/db/schema";
import { MtgCard } from "@/types/MtgCard";
import { parseSearchQuery } from "@/lib/search/queryBuilder";
import { getSortConfig, buildSortSpec } from "@/lib/sortConfig";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CardSearchOptions {
  /** Scryfall-style query string (null/empty matches everything). */
  queryString?: string | null;
  /** 1-based page number. Must already be validated (>= 1). */
  page: number;
  /** Page length. Must already be validated (>= 1). */
  pageLen: number;
  /** Sort field — must be one of getValidSortFields(). */
  order: string;
  dir: "asc" | "desc";
  /** Restrict to cards that exist as at least one physical copy. */
  owned?: boolean;
  /**
   * When set together with `owned`, only that user's physical copies count.
   * GET /api/cards passes nothing here (its `owned` filter is app-wide); the
   * AI `searchMyCards` tool passes the session user.
   */
  ownerId?: string;
}

export interface CardSearchResult {
  cards: MtgCard[];
  total: number;
  totalPages: number;
  hasMore: boolean;
}

/**
 * Build the aggregation stages implementing the `owned` filter: keep only cards
 * with at least one PhysicalCard back-reference (optionally scoped to one
 * owner), then drop the joined array again.
 */
function buildOwnedFilterStages(ownerId?: string): any[] {
  const lookup = ownerId
    ? {
        $lookup: {
          from: "physicalcards",
          let: { cid: "$id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$cardId", "$$cid"] },
                owner: new Types.ObjectId(ownerId)
              }
            },
            { $limit: 1 },
            { $project: { _id: 1 } }
          ],
          as: "ownedIn"
        }
      }
    : {
        $lookup: {
          from: "physicalcards",
          localField: "id",
          foreignField: "cardId",
          as: "ownedIn"
        }
      };

  return [lookup, { $match: { "ownedIn.0": { $exists: true } } }, { $project: { ownedIn: 0 } }];
}

/**
 * The shared query core of card search: parse the query string, apply the
 * optional owned filter, sort (plain or aggregation-backed), and paginate.
 * Used by GET /api/cards and by the AI searchCards/searchMyCards tools.
 *
 * Inputs are assumed pre-validated (page/pageLen >= 1, `order` a valid sort
 * field, `dir` asc|desc) — callers own request validation.
 */
export async function runCardSearch(options: CardSearchOptions): Promise<CardSearchResult> {
  const { queryString, page, pageLen, order, dir, owned = false, ownerId } = options;

  const skip = (page - 1) * pageLen;
  const limit = pageLen;

  const searchQuery = parseSearchQuery(queryString ?? null);

  const sortConfig = getSortConfig(order);
  if (!sortConfig) throw new Error(`Invalid sort configuration for order "${order}"`);

  const sortDirection: 1 | -1 = dir === "asc" ? 1 : -1;

  let cards: MtgCard[];
  let total: number;

  // Use an aggregation pipeline for complex sorting or the owned filter,
  // otherwise a simple find + sort.
  if ((sortConfig.useAggregation && sortConfig.buildAggregationSort) || owned) {
    const pipeline: any[] = [{ $match: searchQuery }];

    if (owned) pipeline.push(...buildOwnedFilterStages(ownerId));

    if (sortConfig.useAggregation && sortConfig.buildAggregationSort) {
      pipeline.push(...sortConfig.buildAggregationSort(sortDirection));
    } else {
      // Plain (possibly multi-key) sort in the pipeline; buildSortSpec appends
      // the `_id` tiebreaker that keeps pagination stable.
      pipeline.push({ $sort: buildSortSpec(sortConfig, sortDirection) });
    }

    pipeline.push({ $skip: skip }, { $limit: limit });

    cards = await CardData.aggregate(pipeline);

    // Count with a separate aggregation (lookup + match only; no projection).
    const countPipeline: any[] = [{ $match: searchQuery }];
    if (owned) countPipeline.push(...buildOwnedFilterStages(ownerId).slice(0, 2));
    countPipeline.push({ $count: "total" });
    const countResult = await CardData.aggregate(countPipeline);
    total = countResult.length > 0 ? countResult[0].total : 0;
  } else {
    // Plain (possibly multi-key) sort; buildSortSpec appends the `_id`
    // tiebreaker that keeps pagination stable.
    const sortObject = buildSortSpec(sortConfig, sortDirection);
    cards = (await CardData.find(searchQuery)
      .sort(sortObject)
      .limit(limit)
      .skip(skip)
      .lean()) as unknown as MtgCard[];
    total = await CardData.countDocuments(searchQuery);
  }

  const totalPages = Math.ceil(total / pageLen);

  return { cards, total, totalPages, hasMore: page < totalPages };
}

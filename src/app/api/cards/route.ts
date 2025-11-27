import connectDB from "@/db/mongoose";
import { Card, CardCollectionModel } from "@/db/schema";
import { NextRequest } from "next/server";
import { parseSearchQuery } from "@/lib/search/queryBuilder";
import { getValidSortFields, getSortConfig } from "@/lib/sortConfig";

/**
 * GET /api/cards
 * Searches and retrieves Magic: The Gathering cards with pagination and sorting.
 * 
 * Query Parameters:
 * - q: Search query string (optional)
 * - page: Page number (default: 1)
 * - page-len: Number of cards per page (default: 100)
 * - order: Sort field (default: "name")
 * - dir: Sort direction: "asc" or "desc" (default: "asc")
 * - owned: If "true", only return cards that exist in any collection (optional)
 * 
 * @returns Response containing cards array, pagination info, and sort configuration
 */
export async function GET(request: NextRequest) {
  try {
    // Connect to database
    await connectDB();

    // Get search and pagination parameters
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.get("q");
    const page = parseInt(searchParams.get("page") || "1");
    const pageLen = parseInt(searchParams.get("page-len") || "100");
    const order = searchParams.get("order") || "name";
    const dir = searchParams.get("dir") || "asc";
    const owned = searchParams.get("owned")?.toLowerCase() === "true";

    // Validate pagination parameters
    if (isNaN(page) || isNaN(pageLen) || page < 1 || pageLen < 1)
      return Response.json({ error: "Invalid pagination parameters" }, { status: 400 });

    // Validate sort parameters
    const validOrders = getValidSortFields();
    if (!validOrders.includes(order))
      return Response.json({ error: `Invalid order parameter. Valid values: ${validOrders.join(', ')}` }, { status: 400 });
    
    if (dir !== "asc" && dir !== "desc")
      return Response.json({ error: "Invalid dir parameter. Must be 'asc' or 'desc'" }, { status: 400 });

    // Calculate skip and limit from page and page-len
    const skip = (page - 1) * pageLen;
    const limit = pageLen;

    // Build the search query from the query string
    const searchQuery = parseSearchQuery(queryString);

    // Get sort configuration
    const sortConfig = getSortConfig(order);
    if (!sortConfig) {
      return Response.json({ error: "Invalid sort configuration" }, { status: 500 });
    }

    const sortDirection: 1 | -1 = dir === "asc" ? 1 : -1;

    let cards;
    let total;

    // Helper to build owned filter stages
    const buildOwnedFilterStages = () => [
      {
        $lookup: {
          from: "cardcollections",
          localField: "id",
          foreignField: "cards.cardId",
          as: "ownedIn"
        }
      },
      {
        $match: {
          "ownedIn.0": { $exists: true }
        }
      },
      {
        $project: {
          ownedIn: 0
        }
      }
    ];

    // Use aggregation pipeline for complex sorting or owned filter, otherwise use simple sort
    if ((sortConfig.useAggregation && sortConfig.buildAggregationSort) || owned) {
      // Build aggregation pipeline
      const pipeline: any[] = [
        // Match the search query
        { $match: searchQuery }
      ];

      // Add owned filter using $lookup if enabled
      if (owned) {
        pipeline.push(...buildOwnedFilterStages());
      }

      // Add custom sorting stages if needed
      if (sortConfig.useAggregation && sortConfig.buildAggregationSort) {
        pipeline.push(...sortConfig.buildAggregationSort(sortDirection));
      } else {
        // Use simple sort in pipeline
        pipeline.push({ $sort: { [sortConfig.field]: sortDirection } });
      }

      // Add pagination
      pipeline.push(
        { $skip: skip },
        { $limit: limit }
      );

      cards = await Card.aggregate(pipeline);
      
      // Get total count with a separate aggregation
      const countPipeline: any[] = [
        { $match: searchQuery }
      ];

      // Add owned filter to count pipeline
      if (owned) {
        countPipeline.push(...buildOwnedFilterStages().slice(0, 2)); // Only lookup and match, skip project
      }

      countPipeline.push({ $count: 'total' });
      const countResult = await Card.aggregate(countPipeline);
      total = countResult.length > 0 ? countResult[0].total : 0;
    } else {
      // Simple sort
      const sortObject: { [key: string]: 1 | -1 } = { [sortConfig.field]: sortDirection };
      cards = await Card.find(searchQuery)
        .sort(sortObject)
        .limit(limit)
        .skip(skip)
        .lean();
      total = await Card.countDocuments(searchQuery);
    }

    const totalPages = Math.ceil(total / pageLen);

    return Response.json({
      cards,
      query: queryString || null,
      pagination: {
        total,
        page,
        pageLen,
        totalPages,
        hasMore: page < totalPages
      },
      sort: {
        order,
        dir
      }
    });
  } catch (error) {
    console.error("Error fetching cards:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

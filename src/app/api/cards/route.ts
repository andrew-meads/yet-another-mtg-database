import connectDB from "@/db/mongoose";
import { Card } from "@/db/schema";
import { NextRequest } from "next/server";
import { parseSearchQuery } from "@/lib/search/queryBuilder";
import { getValidSortFields, getSortConfig } from "@/lib/sortConfig";

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

    // Use aggregation pipeline for complex sorting, otherwise use simple sort
    if (sortConfig.useAggregation && sortConfig.buildAggregationSort) {
      // Build aggregation pipeline
      const pipeline: any[] = [
        // Match the search query
        { $match: searchQuery },
        // Add custom sorting stages
        ...sortConfig.buildAggregationSort(sortDirection),
        // Pagination
        { $skip: skip },
        { $limit: limit }
      ];

      cards = await Card.aggregate(pipeline);
      
      // Get total count with a separate aggregation
      const countPipeline = [
        { $match: searchQuery },
        { $count: 'total' }
      ];
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

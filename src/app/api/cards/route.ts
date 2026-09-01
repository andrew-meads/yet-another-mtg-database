import connectDB from "@/db/mongoose";
import { NextRequest } from "next/server";
import { getValidSortFields } from "@/lib/sortConfig";
import { runCardSearch } from "@/lib/server/cardSearch";

/**
 * GET /api/cards
 * Searches and retrieves Magic: The Gathering cards with pagination and sorting.
 * The query core (parse + owned filter + sort + paginate) lives in
 * src/lib/server/cardSearch.ts, shared with the AI search tools.
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
      return Response.json(
        { error: `Invalid order parameter. Valid values: ${validOrders.join(", ")}` },
        { status: 400 }
      );

    if (dir !== "asc" && dir !== "desc")
      return Response.json(
        { error: "Invalid dir parameter. Must be 'asc' or 'desc'" },
        { status: 400 }
      );

    const { cards, total, totalPages, hasMore } = await runCardSearch({
      queryString,
      page,
      pageLen,
      order,
      dir,
      owned
    });

    return Response.json({
      cards,
      query: queryString || null,
      pagination: {
        total,
        page,
        pageLen,
        totalPages,
        hasMore
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

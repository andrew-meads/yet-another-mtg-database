import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/db/mongoose";
import { SetSvgModel } from "@/db/schema";

/**
 * GET handler for retrieving set icon SVGs by set code.
 *
 * Checks the database cache first, and if not found, fetches from Scryfall API
 * and caches the result for future requests.
 *
 * @param request - The incoming request object
 * @param params - Route parameters containing the set code
 * @returns NextResponse with the SVG content or an error
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    await connectDB();

    const { code } = await params;
    const setCode = code.toLowerCase();

    // Check if SVG is already cached in database
    let setSvg = (await SetSvgModel.findOne({ setCode }))?.svgContent;

    if (!setSvg) {
      // Fetch from Scryfall if not in DB
      setSvg = await fetchSetSvgFromScryfall(setCode);

      // If still not found, return 404
      if (!setSvg) {
        return NextResponse.json({ error: "Set SVG not found" }, { status: 404 });
      }

      // Save to DB for future requests
      const newSetSvg = new SetSvgModel({ setCode, svgContent: setSvg });
      await newSetSvg.save();
    }

    return new NextResponse(setSvg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch (error) {
    console.error("Error fetching set SVG:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Fetches a set's SVG icon from the Scryfall API.
 *
 * Makes two API calls: first to get the set information (including icon_svg_uri),
 * then to fetch the actual SVG content from that URI.
 *
 * @param setCode - The set code to fetch (should be lowercase)
 * @returns Promise resolving to the SVG content as a string
 * @throws Error if the set is not found, has no SVG available, or fetch fails
 */
async function fetchSetSvgFromScryfall(setCode: string): Promise<string> {
  // Fetch set info from Scryfall
  const setResponse = await fetch(`https://api.scryfall.com/sets/${setCode}`);

  if (!setResponse.ok) {
    throw new Error("Set not found");
  }

  const setData = await setResponse.json();
  if (!setData.icon_svg_uri) {
    throw new Error("Set SVG not available");
  }

  // Fetch the SVG content
  const svgResponse = await fetch(setData.icon_svg_uri);

  if (!svgResponse.ok) {
    throw new Error("Failed to fetch SVG");
  }

  const svgContent = await svgResponse.text();
  return svgContent;
}

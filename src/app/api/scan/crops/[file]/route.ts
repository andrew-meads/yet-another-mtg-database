import { NextRequest, NextResponse } from "next/server";

const SCANNER_BASE_URL = process.env.SCANNER_BASE_URL || "http://localhost:8000";

// Only allow plain image filenames — blocks path traversal and unexpected paths.
const FILE_PATTERN = /^[\w-]+\.(jpe?g|png)$/i;

/**
 * GET /api/scan/crops/[file]
 *
 * Auth-guarded proxy (enforced by src/proxy.ts) for the de-skewed card crops the
 * card-scanner backend produces. The scanner serves them at
 * `${SCANNER_BASE_URL}/cards/<file>`; the client passes the basename of a scanned
 * card's `url`. Rendered via a plain <img> (the Next image optimizer can't carry
 * the user's auth cookie to this protected route).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;

  if (!FILE_PATTERN.test(file)) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  try {
    const res = await fetch(`${SCANNER_BASE_URL}/cards/${file}`);

    if (!res.ok) {
      const status = res.status === 404 ? 404 : 502;
      return NextResponse.json({ error: "Crop not found" }, { status });
    }

    const contentType = res.headers.get("Content-Type") || "image/jpeg";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch (error) {
    console.error("Error proxying card crop:", error);
    return NextResponse.json({ error: "Card scanner unavailable" }, { status: 502 });
  }
}

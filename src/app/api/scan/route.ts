import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

const SCANNER_BASE_URL = process.env.SCANNER_BASE_URL || "http://localhost:8000";

/**
 * POST /api/scan
 *
 * Auth-guarded proxy to the external card-scanner backend. Forwards the uploaded
 * card photo (multipart "image" field) to `${SCANNER_BASE_URL}/api/scan`, which
 * de-skews each card and returns ranked Scryfall matches, and passes that JSON
 * response back to the client verbatim.
 *
 * Request body:
 * - FormData with an "image" field containing the card image as a Blob
 *
 * Response:
 * - 200 OK with the scanner's JSON (crops + ranked matches), forwarding its status
 * - 400 Bad Request if the image is missing or invalid
 * - 401 Unauthorized if there is no session (also enforced by src/proxy.ts)
 * - 502 Bad Gateway if the card scanner is unreachable
 */
export async function POST(request: NextRequest) {
  // Auth check (the proxy middleware also guards /api/* routes).
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Extract and validate the uploaded image.
  const formData = await request.formData();
  const image = formData.get("image");
  if (!(image instanceof Blob)) {
    return Response.json({ error: "No image provided or invalid image format" }, { status: 400 });
  }

  // Forward to the card-scanner backend, rebuilding the multipart form so fetch
  // sets a fresh boundary.
  try {
    const upstream = new FormData();
    upstream.append("image", image);

    const res = await fetch(`${SCANNER_BASE_URL}/api/scan`, {
      method: "POST",
      body: upstream
    });

    // Pass the scanner's body and status straight through.
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" }
    });
  } catch (error) {
    console.error("Error proxying to card scanner:", error);
    return Response.json({ error: "Card scanner unavailable" }, { status: 502 });
  }
}

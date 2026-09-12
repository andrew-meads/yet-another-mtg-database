/**
 * Thin client for the card-scanner backend.
 *
 * In development, requests use relative URLs ("/api/...") which the Vite dev
 * server proxies to the FastAPI backend (see vite.config.ts), so there is no
 * CORS configuration to worry about here.
 */
import type { ScanResponse } from './types'

/**
 * Upload a captured photo to the backend for card detection + de-skew.
 *
 * @param image - The captured frame as a Blob (JPEG/PNG).
 * @returns The parsed scan response (card URLs, count, optional debug overlay).
 * @throws Error if the request fails or the server returns a non-2xx status.
 */
export async function scanImage(image: Blob): Promise<ScanResponse> {
  // The backend expects a multipart form with a single `image` field.
  const form = new FormData()
  form.append('image', image, 'capture.jpg')

  const res = await fetch('/api/scan', { method: 'POST', body: form })

  if (!res.ok) {
    // Surface the server's error detail when available for easier debugging.
    let detail = `Request failed with status ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* response wasn't JSON; keep the generic message */
    }
    throw new Error(detail)
  }

  return (await res.json()) as ScanResponse
}

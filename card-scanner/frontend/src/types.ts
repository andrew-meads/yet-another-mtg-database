/**
 * Shared types mirroring the backend JSON contract for `POST /api/scan`.
 */

/** One candidate identification for a detected card (Part 2). */
export interface CardMatch {
  /** Scryfall id of the matched printing. */
  scryfallId: string
  /** Card (or face) name. */
  name: string
  /** Set code, e.g. "tla". */
  set: string | null
  /** Collector number within the set. */
  collectorNumber: string | null
  /** Which face this row represents ("single" | "front" | "back"). */
  face: string | null
  /** Stage-1 perceptual-hash Hamming distance (lower = closer). */
  hammingDistance: number
  /** Stage-2 feature score (RANSAC inliers, or good-match count fallback). */
  featureScore: number
  /** Number of geometrically verified inlier matches. */
  inliers: number
  /** Whether the match cleared the confidence floor. */
  confident: boolean
  /** Scryfall CDN image URL (for the verification thumbnail). */
  imageUrl: string | null
  /** Link to the card's Scryfall page. */
  scryfallUri: string | null
}

/** A single de-skewed card returned by the backend. */
export interface ScannedCard {
  /** Stable id; also the saved filename stem (e.g. "<batch>_0"). */
  id: string
  /** Relative URL to the saved crop, e.g. "/cards/<id>.jpg". */
  url: string
  /** Output crop width in pixels. */
  width: number
  /** Output crop height in pixels. */
  height: number
  /** Ranked identification candidates (best first); empty if no index built. */
  matches: CardMatch[]
}

/** Full response body of `POST /api/scan`. */
export interface ScanResponse {
  /** Number of cards detected. */
  count: number
  /** One entry per detected card. */
  cards: ScannedCard[]
  /** URL to a debug overlay of the original with quads drawn, or null. */
  debugUrl: string | null
}

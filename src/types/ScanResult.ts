/**
 * Shapes returned by the card-scanner backend, proxied through `POST /api/scan`.
 * The scanner detects and de-skews one or more cards from a single photo and,
 * for each, returns a pre-ranked (best-first) list of candidate Scryfall printings.
 */

/** A single candidate Scryfall printing for a detected card (ranked best-first). */
export interface ScanMatch {
  scryfallId: string;
  name: string;
  set: string;
  collectorNumber: string;
  face: string;
  /** Whether the matcher cleared its confidence floor. */
  confident: boolean;
  /** Scryfall CDN image for this printing/face. */
  imageUrl: string;
  scryfallUri: string;

  // Matcher scores (best-first ordering already reflects these).
  hammingDistance?: number;
  featureScore?: number;
  inliers?: number;
}

/** One card detected in the photo: its de-skewed crop plus ranked matches. */
export interface ScannedCard {
  /** Scanner-assigned id, e.g. "<batch>_0". */
  id: string;
  /** Scanner-relative crop URL, e.g. "/cards/<batch>_0.jpg" (served via the crop proxy). */
  url: string;
  width: number;
  height: number;
  matches: ScanMatch[];
}

/** Full response from `POST /api/scan`. */
export interface ScanResponse {
  count: number;
  cards: ScannedCard[];
  debugUrl: string | null;
}

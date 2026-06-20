import { MtgCard } from "@/types/MtgCard";

/**
 * Shapes involved in card scanning.
 *
 * The external card-scanner backend (proxied through `POST /api/scan`) detects and
 * de-skews one or more cards from a single photo and, for each, returns a pre-ranked
 * (best-first) list of candidate Scryfall printings — the `Raw*` shapes below.
 *
 * We deliberately trust only the `scryfallId` from those raw matches: `POST /api/scan`
 * re-hydrates each match from our local `cards` collection so the client always renders
 * the same `MtgCard` data (name, set, rarity, collector number, images) as the rest of
 * the app. The enriched shapes (`ScannedCard`, `ScanResponse`) are what the client sees.
 */

// ---------------------------------------------------------------------------
// Raw scanner response (verbatim from the backend; only `scryfallId` is consumed).
// ---------------------------------------------------------------------------

/** A single candidate Scryfall printing as returned by the scanner (ranked best-first). */
export interface RawScanMatch {
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

/** One detected card as returned by the scanner: its de-skewed crop plus ranked matches. */
export interface RawScannedCard {
  /** Scanner-assigned id, e.g. "<batch>_0". */
  id: string;
  /** Scanner-relative crop URL, e.g. "/cards/<batch>_0.jpg" (served via the crop proxy). */
  url: string;
  width: number;
  height: number;
  matches: RawScanMatch[];
}

/** Full verbatim response from the scanner backend. */
export interface RawScanResponse {
  count: number;
  cards: RawScannedCard[];
  debugUrl: string | null;
}

// ---------------------------------------------------------------------------
// Enriched response (what `POST /api/scan` returns and the client consumes).
// ---------------------------------------------------------------------------

/**
 * One card detected in the photo: its de-skewed crop plus the candidate printings,
 * each re-hydrated from our local `cards` DB and kept in the scanner's best-first order.
 */
export interface ScannedCard {
  /** Scanner-assigned id, e.g. "<batch>_0". */
  id: string;
  /** Scanner-relative crop URL, e.g. "/cards/<batch>_0.jpg" (served via the crop proxy). */
  url: string;
  width: number;
  height: number;
  /** Candidate printings sourced from local card data, best-first. */
  matches: MtgCard[];
}

/** Full response from `POST /api/scan` (enriched). */
export interface ScanResponse {
  count: number;
  cards: ScannedCard[];
  debugUrl: string | null;
}

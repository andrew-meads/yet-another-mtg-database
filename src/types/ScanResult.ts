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
  /** Ratio-test survivors before geometric verification. */
  goodMatches?: number;
  /** Score after fusing inliers with the OCR name / collector-line evidence. */
  fusedScore?: number;
  /** Which confidence rule made the top match `confident` ("A" image margin, "B" name, "C" collector line). */
  confidenceRule?: "A" | "B" | "C" | null;
  /** The OCR-read card name this candidate matched, if any. */
  nameMatch?: { key: string; score: number } | null;
  /** The OCR-read collector line this candidate agrees with, if any. */
  collectorMatch?: { set: string | null; number: string; lang: string | null } | null;
  /** How the candidate entered the shortlist: "hash" (pHash), "name" and/or "cn" (OCR). */
  shortlistSources?: string[];
  /** Upright orientation of the crop implied by this candidate's validated homography (0 or 180). */
  rotation?: 0 | 180 | null;
}

/** What the scanner's OCR stage read from a crop (informational; the app ignores it). */
export interface RawScanOcr {
  name: { key: string; score: number; text: string } | null;
  candidates: Array<{ key: string; score: number }>;
  collector: {
    set: string | null;
    number: string;
    lang: string | null;
    rarity: string | null;
  } | null;
  orientation: 0 | 180 | null;
  elapsedMs: Record<string, number>;
  lines?: Array<{ text: string; conf: number; source: string }>;
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
  /** Detection strategy that produced the quad ("edges", "color", "split", …). */
  source?: string;
  /** Detector's geometric candidate score (0–1). */
  detectScore?: number;
  /** Hamming distance of the crop to the nearest indexed card (the detector's verification). */
  hashDistance?: number | null;
  /** Orientation applied to the saved crop (0 or 180). */
  orientation?: number | null;
  /** OCR summary for the crop, or null when OCR did not run. */
  ocr?: RawScanOcr | null;
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

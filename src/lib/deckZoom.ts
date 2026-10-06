/**
 * Deck-editor zoom: a percentage (20–200, default 100) that scales the card stacks.
 *
 * The slider is piecewise linear so 100% sits exactly in the middle of its track: the
 * left half covers 20–100% and the right half 100–200%. Slider positions are integers
 * in `0..ZOOM_SLIDER_MAX`.
 */

export const ZOOM_MIN = 20;
export const ZOOM_MAX = 200;
export const ZOOM_DEFAULT = 100;

/** localStorage key for the zoom (device-local, shared by every deck). */
export const DECK_ZOOM_STORAGE_KEY = "deck-view-zoom";

/** Slider track resolution; the midpoint (`ZOOM_SLIDER_MAX / 2`) is 100%. */
export const ZOOM_SLIDER_MAX = 200;
const MID = ZOOM_SLIDER_MAX / 2;

/** Slider positions within this distance of the midpoint (≈91–111%) snap to 100%. */
export const ZOOM_SNAP_DISTANCE = 12;

/** Clamp to the supported range and round to a whole percent; non-numbers become 100%. */
export function clampZoom(zoom: unknown): number {
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) return ZOOM_DEFAULT;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)));
}

/** Slider position → zoom percent (whole number). */
export function sliderToZoom(position: number): number {
  const p = Math.min(ZOOM_SLIDER_MAX, Math.max(0, position));
  const zoom =
    p <= MID
      ? ZOOM_MIN + (p / MID) * (ZOOM_DEFAULT - ZOOM_MIN)
      : ZOOM_DEFAULT + ((p - MID) / MID) * (ZOOM_MAX - ZOOM_DEFAULT);
  return Math.round(zoom);
}

/** Zoom percent → slider position (may be fractional). */
export function zoomToSlider(zoom: number): number {
  const z = clampZoom(zoom);
  return z <= ZOOM_DEFAULT
    ? ((z - ZOOM_MIN) / (ZOOM_DEFAULT - ZOOM_MIN)) * MID
    : MID + ((z - ZOOM_DEFAULT) / (ZOOM_MAX - ZOOM_DEFAULT)) * MID;
}

/** Slider position → zoom percent, snapping to 100% near the middle of the track. */
export function sliderToSnappedZoom(position: number): number {
  return Math.abs(position - MID) <= ZOOM_SNAP_DISTANCE ? ZOOM_DEFAULT : sliderToZoom(position);
}

/** Card size in the deck editor at 100% zoom (Scryfall's "small" image size). */
export const CARD_WIDTH = 146;
export const CARD_HEIGHT = 204;
/** How much of each card shows above the next one in a column's overlapping stack. */
export const OVERLAP_OFFSET = 30;
/** Column chrome above the first card: 1px border + 4px padding (p-1). Not scaled. */
export const CONTAINER_OFFSET = 5;
/** Gap between columns at 100% zoom (Tailwind gap-3). */
export const COLUMN_GAP = 12;

/** Below this zoom the per-card overlay badges are hidden — there's no room for them. */
export const OVERLAY_MIN_ZOOM = 40;
/** Below this zoom the empty-column placeholders drop their text labels. */
export const PLACEHOLDER_LABEL_MIN_ZOOM = 50;

export interface DeckCardDimensions {
  /** The zoom these dimensions were computed for, as a fraction (1 = 100%). */
  scale: number;
  cardWidth: number;
  cardHeight: number;
  overlapOffset: number;
  columnGap: number;
}

/** Card-stack dimensions (whole pixels) for a zoom percent. */
export function deckCardDimensions(zoom: number): DeckCardDimensions {
  const scale = clampZoom(zoom) / 100;
  return {
    scale,
    cardWidth: Math.round(CARD_WIDTH * scale),
    cardHeight: Math.round(CARD_HEIGHT * scale),
    overlapOffset: Math.max(1, Math.round(OVERLAP_OFFSET * scale)),
    columnGap: Math.max(4, Math.round(COLUMN_GAP * scale))
  };
}

/** Per-scanned-card UI state, lifted to the results page so it survives the detail
 *  sheet closing/reopening and drives the overview tiles' captions and badges. */
export interface CardUiState {
  /** Index of the currently selected candidate printing. */
  selectedIndex: number;
  /** Quantity to add. */
  quantity: number;
  /** Number of copies the user has successfully added for this scanned card. */
  addedCount: number;
}

export const defaultCardUiState: CardUiState = {
  selectedIndex: 0,
  quantity: 1,
  addedCount: 0
};

/** Build the same-origin proxy URL for a scanner crop from its scanner-relative url. */
export function cropProxyUrl(url: string): string {
  const file = url.split("/").pop() || "";
  return `/api/scan/crops/${file}`;
}

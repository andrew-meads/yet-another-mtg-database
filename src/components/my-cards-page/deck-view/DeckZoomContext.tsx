"use client";

import { createContext, useContext, useMemo } from "react";
import { DeckCardDimensions, ZOOM_DEFAULT, deckCardDimensions } from "@/lib/deckZoom";

const DeckZoomContext = createContext<DeckCardDimensions>(deckCardDimensions(ZOOM_DEFAULT));

/**
 * Provides the deck editor's zoomed card dimensions to its sections and columns.
 * Consumers outside a provider get the 100% dimensions.
 */
export function DeckZoomProvider({ zoom, children }: { zoom: number; children: React.ReactNode }) {
  const dimensions = useMemo(() => deckCardDimensions(zoom), [zoom]);
  return <DeckZoomContext.Provider value={dimensions}>{children}</DeckZoomContext.Provider>;
}

/** The current deck-editor card dimensions (100% outside a {@link DeckZoomProvider}). */
export function useDeckCardDimensions(): DeckCardDimensions {
  return useContext(DeckZoomContext);
}

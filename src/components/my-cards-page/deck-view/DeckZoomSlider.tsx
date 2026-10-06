"use client";

import { useRef } from "react";
import { ZoomIn } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ZOOM_DEFAULT,
  ZOOM_SLIDER_MAX,
  clampZoom,
  sliderToSnappedZoom,
  sliderToZoom,
  zoomToSlider
} from "@/lib/deckZoom";

interface DeckZoomSliderProps {
  /** Zoom percent (20–200). */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  className?: string;
}

/**
 * Deck-editor zoom control: a slider with 100% at the middle of its track that snaps
 * to 100% when dragged near it, plus a percentage button that resets to 100%.
 */
export default function DeckZoomSlider({ zoom, onZoomChange, className }: DeckZoomSliderProps) {
  const current = clampZoom(zoom);
  // Snapping only applies to pointer drags: an arrow-key step away from 100% lands
  // inside the snap zone and would otherwise be pulled straight back.
  const keyboardRef = useRef(false);

  return (
    <div className={cn("flex items-center gap-2", className)} data-testid="deck-zoom">
      <ZoomIn className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <div className="relative w-40">
        {/* Tick marking 100% at the middle of the track. */}
        <div
          className="bg-muted-foreground/50 pointer-events-none absolute top-1/2 left-1/2 h-3 w-px -translate-1/2"
          aria-hidden
        />
        <Slider
          thumbProps={{ "aria-label": "Zoom", "aria-valuetext": `${current}%` }}
          min={0}
          max={ZOOM_SLIDER_MAX}
          step={1}
          value={[zoomToSlider(current)]}
          onPointerDown={() => (keyboardRef.current = false)}
          onKeyDown={() => (keyboardRef.current = true)}
          onValueChange={([position]) => {
            const next = keyboardRef.current
              ? sliderToZoom(position)
              : sliderToSnappedZoom(position);
            if (next !== current) onZoomChange(next);
          }}
        />
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-14 px-1 text-xs tabular-nums"
        title="Reset zoom to 100%"
        onClick={() => onZoomChange(ZOOM_DEFAULT)}
        data-testid="deck-zoom-value"
      >
        {current}%
      </Button>
    </div>
  );
}

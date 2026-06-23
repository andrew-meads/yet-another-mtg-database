"use client";

import CardArtView from "@/components/CardArtView";
import type { CardPreviewSize } from "@/context/SettingsContext";
import type { MtgCard } from "@/types/MtgCard";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface CardPopupProps {
  card: MtgCard;
  position: { x: number; y: number };
  /** On-screen size of the preview; also selects the image resolution variant */
  size?: CardPreviewSize;
}

/**
 * Per-size container height (px) and matching Scryfall image variant.
 * "normal" preserves the original 400px / "normal" behaviour.
 */
const SIZE_CONFIG: Record<CardPreviewSize, { height: number; variant: "small" | "normal" | "large" }> = {
  small: { height: 260, variant: "small" },
  normal: { height: 400, variant: "normal" },
  large: { height: 540, variant: "large" }
};

export default function CardPopup({ card, position, size = "normal" }: CardPopupProps) {
  const { height: popupHeight, variant } = SIZE_CONFIG[size];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ x: number; y: number }>(position);
  const lastPosRef = useRef(position);
  const [measured, setMeasured] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    lastPosRef.current = position;
  }, [position]);

  useEffect(() => {
    if (!containerRef.current || typeof window === "undefined") return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setMeasured((prev) => (prev.w !== w || prev.h !== h ? { w, h } : prev));
    });
    ro.observe(el);
    // Prime the size on first mount
    setMeasured({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  const computePlacement = useCallback(
    (pos: { x: number; y: number }, dims: { w: number; h: number }) => {
      if (typeof window === "undefined") return pos;
      const margin = 8; // padding from viewport edges
      const offset = 12; // cursor offset for UX

      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const elW = dims.w || Math.round(popupHeight * (63 / 88)); // width fallback from MTG aspect
      const elH = dims.h || popupHeight; // matches the container height for this size

      const candidates = [
        // Prefer bottom-right of cursor
        { x: pos.x + offset, y: pos.y + offset },
        // bottom-left
        { x: pos.x - elW - offset, y: pos.y + offset },
        // top-right
        { x: pos.x + offset, y: pos.y - elH - offset },
        // top-left
        { x: pos.x - elW - offset, y: pos.y - elH - offset }
      ];

      const fits = (c: { x: number; y: number }) =>
        c.x >= margin &&
        c.y >= margin &&
        c.x + elW <= viewportW - margin &&
        c.y + elH <= viewportH - margin;

      const best = candidates.find(fits);
      if (best) return best;

      // If none fit entirely, clamp the preferred BR option to viewport
      const pref = candidates[0];
      const clampedX = Math.min(Math.max(pref.x, margin), viewportW - elW - margin);
      const clampedY = Math.min(Math.max(pref.y, margin), viewportH - elH - margin);
      return { x: clampedX, y: clampedY };
    },
    [popupHeight]
  );

  // Compute position synchronously before paint to avoid flicker
  useLayoutEffect(() => {
    const elW = containerRef.current?.offsetWidth ?? measured.w;
    const elH = containerRef.current?.offsetHeight ?? measured.h;
    const next = computePlacement(lastPosRef.current, { w: elW, h: elH });
    setCoords(next);
    setReady(true);
  }, [position.x, position.y, measured.w, measured.h, computePlacement]);

  // Recompute on window resize (async is fine post-initial)
  useEffect(() => {
    const onResize = () => {
      setCoords(() => computePlacement(lastPosRef.current, { w: measured.w, h: measured.h }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measured.w, measured.h, computePlacement]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none z-50"
      style={{
        position: "fixed",
        left: ready ? coords.x : -10000,
        top: ready ? coords.y : -10000,
        opacity: ready ? 1 : 0
      }}
    >
      <div
        className="bg-background overflow-hidden rounded-md p-1 shadow-lg ring-1 ring-black/10"
        style={{ height: popupHeight }}
      >
        <CardArtView card={card} variant={variant} flippable={false} />
      </div>
    </div>
  );
}

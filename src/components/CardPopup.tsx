"use client";

import CardArtView from "@/components/CardArtView";
import type { ICard } from "@/types/ICard";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface CardPopupProps {
  card: ICard;
  position: { x: number; y: number };
}

export default function CardPopup({ card, position }: CardPopupProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ x: number; y: number }>(position);
  const lastPosRef = useRef(position);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
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
      setSize(prev => (prev.w !== w || prev.h !== h ? { w, h } : prev));
    });
    ro.observe(el);
    // Prime the size on first mount
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  const computePlacement = (pos: { x: number; y: number }, dims: { w: number; h: number }) => {
    if (typeof window === "undefined") return pos;
    const margin = 8; // padding from viewport edges
    const offset = 12; // cursor offset for UX

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const elW = dims.w || Math.round(400 * (63 / 88)); // ~286px fallback based on MTG aspect
    const elH = dims.h || 400; // matches our fixed h-[400px]

    const candidates = [
      // Prefer bottom-right of cursor
      { x: pos.x + offset, y: pos.y + offset },
      // bottom-left
      { x: pos.x - elW - offset, y: pos.y + offset },
      // top-right
      { x: pos.x + offset, y: pos.y - elH - offset },
      // top-left
      { x: pos.x - elW - offset, y: pos.y - elH - offset },
    ];

    const fits = (c: { x: number; y: number }) =>
      c.x >= margin && c.y >= margin && c.x + elW <= viewportW - margin && c.y + elH <= viewportH - margin;

    const best = candidates.find(fits);
    if (best) return best;

    // If none fit entirely, clamp the preferred BR option to viewport
    const pref = candidates[0];
    const clampedX = Math.min(Math.max(pref.x, margin), viewportW - elW - margin);
    const clampedY = Math.min(Math.max(pref.y, margin), viewportH - elH - margin);
    return { x: clampedX, y: clampedY };
  };

  // Compute position synchronously before paint to avoid flicker
  useLayoutEffect(() => {
    const elW = containerRef.current?.offsetWidth ?? size.w;
    const elH = containerRef.current?.offsetHeight ?? size.h;
    const next = computePlacement(lastPosRef.current, { w: elW, h: elH });
    setCoords(next);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.x, position.y, size.w, size.h]);

  // Recompute on window resize (async is fine post-initial)
  useEffect(() => {
    const onResize = () => {
      setCoords((prev) => computePlacement(lastPosRef.current, { w: size.w, h: size.h }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size.w, size.h]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none z-50"
      style={{ position: "fixed", left: ready ? coords.x : -10000, top: ready ? coords.y : -10000, opacity: ready ? 1 : 0 }}
    >
      <div className="rounded-md shadow-lg ring-1 ring-black/10 overflow-hidden bg-background p-1 h-[400px]">
        <CardArtView card={card} variant="normal" flippable={false} />
      </div>
    </div>
  );
}

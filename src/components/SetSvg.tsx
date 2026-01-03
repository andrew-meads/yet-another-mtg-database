"use client";

import { useRetrieveSetSvg } from "@/hooks/react-query/useRetrieveSetSvg";
import { cn } from "@/lib/utils";
import styles from "./SetSvg.module.css";

interface SetSvgProps {
  setCode: string;
  rarityCode?: string;
  width?: number;
  height?: number;
  className?: string;
}

const RARITY_STYLES: Record<string, { fill: string }> = {
  common: { fill: "var(--rarity-common-fill)" },
  uncommon: { fill: "var(--rarity-uncommon-fill)" },
  rare: { fill: "var(--rarity-rare-fill)" },
  mythic: { fill: "var(--rarity-mythic-fill)" },
  special: { fill: "var(--rarity-special-fill)" }
};

/**
 * Component for displaying Magic: The Gathering set icons as inline SVGs.
 *
 * Fetches and caches set SVG icons from the API, with optional rarity-based styling.
 *
 * @param setCode - The set code (e.g., "mkm", "lci", "one")
 * @param rarityCode - Optional rarity code for styling (e.g., "common", "rare", "mythic")
 * @param width - Width of the SVG in pixels (default: 24)
 * @param height - Height of the SVG in pixels (default: 24)
 * @param className - Additional CSS classes
 */
export function SetSvg({ setCode, rarityCode, width = 24, height = 24, className }: SetSvgProps) {
  const { data: svgContent, isLoading, error } = useRetrieveSetSvg(setCode);

  if (isLoading) {
    return (
      <div className={cn("animate-pulse bg-muted rounded", className)} style={{ width, height }} />
    );
  }

  if (error || !svgContent) {
    return (
      <div
        className={cn(
          "bg-muted/50 rounded flex items-center justify-center text-xs text-muted-foreground",
          className
        )}
        style={{ width, height }}
        title={error?.message || "Failed to load set icon"}
      >
        ?
      </div>
    );
  }

  let rarityStyle = rarityCode ? RARITY_STYLES[rarityCode?.toLowerCase()] : null;
  if (!rarityStyle) rarityStyle = RARITY_STYLES.common;

  return (
    <div
      className={cn("inline-flex items-center justify-center", className, styles.setIcon)}
      style={
        {
          width,
          height,
          "--set-icon-fill": rarityStyle.fill
        } as React.CSSProperties
      }
      dangerouslySetInnerHTML={{ __html: svgContent }}
      data-rarity={rarityCode}
    />
  );
}

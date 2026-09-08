import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRICE_AGE_DESCRIPTIONS, PriceAgeLevel, priceAge } from "@/lib/pricing";
import { cn } from "@/lib/utils";

interface PriceAgeDotProps {
  /** When the price was written (ISO string or Date); null/undefined = never. */
  updatedAt?: Date | string | null;
  /** Force a level and its explanation (e.g. "stale: estimated from the printing"). */
  override?: { level: PriceAgeLevel; description: string };
  className?: string;
}

const LEVEL_CLASS = {
  fresh: "bg-emerald-500",
  aging: "bg-amber-500",
  stale: "bg-red-500",
  unknown: "bg-muted-foreground/40"
} as const;

/**
 * A small coloured dot grading how old a price is (green < 1 day, amber < 1
 * week, red older, grey unknown) with the exact age in a tooltip. Exposes the
 * level as `data-age-level` for styling/tests.
 */
export default function PriceAgeDot({ updatedAt, override, className }: PriceAgeDotProps) {
  const age = override ? { level: override.level, label: "" } : priceAge(updatedAt);
  const description = override
    ? override.description
    : age.level === "unknown"
      ? "Price age unknown — never fetched"
      : `Price updated ${age.label} (${PRICE_AGE_DESCRIPTIONS[age.level]})`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={description}
          data-age-level={age.level}
          className={cn(
            "inline-block size-2 shrink-0 rounded-full",
            LEVEL_CLASS[age.level],
            className
          )}
        />
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  );
}

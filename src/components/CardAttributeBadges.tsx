import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CONDITION_LABELS,
  CardCondition,
  CardFinish,
  DEFAULT_CONDITION,
  DEFAULT_FINISH,
  FINISH_LABELS,
  effectiveCondition,
  effectiveFinish
} from "@/lib/cardAttributes";
import { cn } from "@/lib/utils";

interface CardAttributeBadgesProps {
  finish?: CardFinish | null;
  condition?: CardCondition | null;
  /** `inline` for table rows (muted pills); `overlay` for on-image chips (dark on light). */
  variant?: "inline" | "overlay";
}

/**
 * Compact badges for a copy's NON-default finish and condition. Renders nothing
 * for an ordinary non-foil / Near Mint copy, so the common case stays clean.
 */
export default function CardAttributeBadges({
  finish,
  condition,
  variant = "inline"
}: CardAttributeBadgesProps) {
  const f = effectiveFinish(finish);
  const c = effectiveCondition(condition);
  const showFinish = f !== DEFAULT_FINISH;
  const showCondition = c !== DEFAULT_CONDITION;
  if (!showFinish && !showCondition) return null;

  const pill = cn(
    "inline-flex shrink-0 items-center rounded px-1 text-[10px] font-semibold uppercase leading-4",
    variant === "inline" ? "bg-secondary text-secondary-foreground" : "bg-black/70 text-white"
  );

  return (
    <span className="inline-flex items-center gap-1" data-testid="card-attribute-badges">
      {showFinish && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(pill, variant === "inline" && "text-amber-700 dark:text-amber-300")}
            >
              {f === "etched" ? "Etched" : "Foil"}
            </span>
          </TooltipTrigger>
          <TooltipContent>{FINISH_LABELS[f]}</TooltipContent>
        </Tooltip>
      )}
      {showCondition && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={pill}>{c}</span>
          </TooltipTrigger>
          <TooltipContent>{CONDITION_LABELS[c]}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

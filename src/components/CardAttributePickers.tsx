"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  CARD_CONDITIONS,
  CARD_FINISHES,
  CONDITION_LABELS,
  CardCondition,
  CardFinish,
  FINISH_LABELS,
  isCardCondition,
  isCardFinish
} from "@/lib/cardAttributes";

interface CardAttributePickersProps {
  finish: CardFinish;
  condition: CardCondition;
  onFinishChange: (finish: CardFinish) => void;
  onConditionChange: (condition: CardCondition) => void;
  size?: "sm" | "default";
  className?: string;
}

/**
 * The finish + condition dropdown pair, shared by the search page's
 * "applied on add" bar and the collection row's per-group editor.
 */
export default function CardAttributePickers({
  finish,
  condition,
  onFinishChange,
  onConditionChange,
  size = "default",
  className
}: CardAttributePickersProps) {
  return (
    <div className={className ?? "flex items-center gap-2"}>
      <Select value={finish} onValueChange={(v) => isCardFinish(v) && onFinishChange(v)}>
        <SelectTrigger size={size} aria-label="Finish" data-testid="finish-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CARD_FINISHES.map((f) => (
            <SelectItem key={f} value={f}>
              {FINISH_LABELS[f]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={condition} onValueChange={(v) => isCardCondition(v) && onConditionChange(v)}>
        <SelectTrigger size={size} aria-label="Condition" data-testid="condition-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CARD_CONDITIONS.map((c) => (
            <SelectItem key={c} value={c}>
              {c} — {CONDITION_LABELS[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

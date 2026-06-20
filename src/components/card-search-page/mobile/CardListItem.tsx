"use client";

import { MtgCard } from "@/types/MtgCard";
import CardArtView from "@/components/CardArtView";
import { ManaCost } from "@/components/CardTextView";
import { useCardSelection } from "@/context/CardSelectionContext";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { SetSvg } from "@/components/SetSvg";

/**
 * Props for the CardListItem component
 */
export interface CardListItemProps {
  /** The card to display */
  card: MtgCard;
  priority?: boolean;
}

/**
 * CardListItem Component
 *
 * Mobile-optimized list item for displaying a single MTG card.
 * Shows a compact horizontal layout with:
 * - Small card thumbnail on the left
 * - Card details on the right (name, set, type, mana cost)
 * - Tap to select the card (shows full details in Card Details tab)
 */
export default function CardListItem({ card, priority = false }: CardListItemProps) {
  const { selectedCard, setSelectedCard } = useCardSelection();
  const router = useRouter();
  const isSelected = selectedCard?.id === card.id;

  const handleClick = () => {
    setSelectedCard(card);
    router.push("/selected-card");
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "flex cursor-pointer gap-3 border-b p-3 transition-colors",
        "hover:bg-accent/50 active:bg-accent",
        isSelected && "bg-accent"
      )}
    >
      {/* Card thumbnail */}
      <div className="w-30 shrink-0 sm:w-20">
        <CardArtView
          card={card}
          variant="small"
          flippable={true}
          draggable={false}
          width="100%"
          height="auto"
          priority={priority}
        />
      </div>

      {/* Card details */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        {/* Card name */}
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold sm:text-base">
            {card.flavor_name || card.name}
          </h3>
          <SetSvg setCode={card.set} rarityCode={card.rarity} width={24} height={24} />
        </div>

        {/* Set info */}
        <p className="text-muted-foreground text-xs">
          {card.set_name} ({card.set.toUpperCase()})
          {card.collector_number && ` #${card.collector_number}`}
        </p>

        {/* Type line */}
        <p className="text-muted-foreground truncate text-xs">{card.type_line}</p>

        {/* Mana cost and P/T */}
        <div className="flex items-center gap-2 text-xs">
          {card.mana_cost && <ManaCost cost={card.mana_cost} />}
          {card.power && card.toughness && (
            <span className="text-muted-foreground">
              {card.power}/{card.toughness}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { MtgCard } from "@/types/MtgCard";
import CardArtView from "@/components/CardArtView";
import { ManaCost } from "@/components/CardTextView";
import { useCardSelection } from "@/context/CardSelectionContext";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

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
        "flex gap-3 p-3 border-b cursor-pointer transition-colors",
        "hover:bg-accent/50 active:bg-accent",
        isSelected && "bg-accent"
      )}
    >
      {/* Card thumbnail */}
      <div className="shrink-0 w-30 sm:w-20">
        <CardArtView
          card={card}
          variant="small"
          flippable={true}
          draggable={false}
          width="100%"
          height="auto"
          priority
        />
      </div>

      {/* Card details */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        {/* Card name */}
        <h3 className="font-semibold text-sm sm:text-base truncate">
          {card.flavor_name || card.name}
        </h3>

        {/* Set info */}
        <p className="text-xs text-muted-foreground">
          {card.set_name} ({card.set.toUpperCase()})
          {card.collector_number && ` #${card.collector_number}`}
        </p>

        {/* Type line */}
        <p className="text-xs text-muted-foreground truncate">{card.type_line}</p>

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

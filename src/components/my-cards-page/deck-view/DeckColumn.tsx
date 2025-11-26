import { SimpleCardArtView } from "@/components/CardArtView";
import { CardCollectionWithCards, DetailedCardEntry } from "@/types/CardCollection";
import { cn } from "@/lib/utils";
import { useCardEntryDragSource } from "@/hooks/drag-drop/useCardEntryDragSource";
import { useState, useRef } from "react";
import { useCardSelection } from "@/context/CardSelectionContext";
import { CARD_WIDTH, CARD_HEIGHT, OVERLAP_OFFSET, CONTAINER_OFFSET } from "./card-dimensions";
import { useCollectionDropTarget } from "@/hooks/drag-drop/useCollectionDropTarget";
import { useUpdateCollectionCards } from "@/hooks/react-query/useUpdateCollectionCards";

interface DeckColumnProps {
  deck: CardCollectionWithCards;
  entry: DetailedCardEntry;
  index: number;
}

export default function DeckColumn({ deck, entry, index }: DeckColumnProps) {
  // Create an array from 1 to entry.quantity inclusive
  const quantityArray = Array.from({ length: entry.quantity }, (_, i) => i + 1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { setSelectedCard } = useCardSelection();
  const { mutate: updateCardsInCollection } = useUpdateCollectionCards();

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || isDragging) return;

    const rect = containerRef.current.getBoundingClientRect();
    const relativeY = e.clientY - rect.top - CONTAINER_OFFSET;

    const clickedIndex = Math.floor(relativeY / OVERLAP_OFFSET);
    const clampedIndex = Math.min(Math.max(0, clickedIndex), entry.quantity - 1);

    setHoverIndex(clampedIndex);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const handleClick = () => {
    setSelectedCard(entry.card);
  };

  const { isDragging, dragRef, draggedItem } = useCardEntryDragSource({
    sourceCollectionId: deck._id,
    sourceIndex: index,
    entry,
    hideDefaultPreview: true,
    getItem: (monitor) => {
      const clientOffset = monitor.getInitialClientOffset();
      const sourceOffset = monitor.getInitialSourceClientOffset();
      let quantity = 1;
      if (clientOffset && sourceOffset) {
        // Adjust for container border and padding
        const relativeY = clientOffset.y - sourceOffset.y - CONTAINER_OFFSET;

        // Calculate which card index was clicked
        // Cards are stacked with OVERLAP_OFFSET (20px) visible for all but the last one
        const clickedIndex = Math.floor(relativeY / OVERLAP_OFFSET);
        // Clamp the index to the valid range [0, entry.quantity - 1]
        const clampedIndex = Math.min(Math.max(0, clickedIndex), entry.quantity - 1);

        // If we click index k, we are dragging cards k through n-1
        quantity = entry.quantity - clampedIndex;
      }

      return {
        sourceCollectionId: deck._id,
        sourceIndex: index,
        entry,
        quantity,
        draggingFromDeckView: true
      };
    }
  });

  // Custom drop behaviour to handle dropping cards at arbitrary positions, swapping, etc.
  const { dropRef, isOver } = useCollectionDropTarget({
    collection: deck,
    allowDrop: true,
    getDestinationIndex: () => index,
    onDrop: ({ sourceCollectionId, card, sourceIndex, quantity }) => {
      // If the source collection exists and is different from this one, return true to use default drop behaviour
      if (sourceCollectionId && sourceCollectionId !== deck._id) return true;

      // If we're dropping a CARD, add it at the drop index.
      if (card) {
        updateCardsInCollection({
          collectionId: deck._id,
          action: "add",
          toIndex: index,
          entry: {
            cardId: card.id,
            quantity: 1
          }
        });
        return false;
      }

      // Otherwise, we're dropping an entry from the same collection. Swap or merge them.
      updateCardsInCollection({
        collectionId: deck._id,
        action: "swap-or-merge",
        fromIndex: sourceIndex,
        toIndex: index,
        quantity
      });
    }
  });

  return (
    <div
      ref={(node) => {
        // Apply dragRef
        dragRef(node as unknown as HTMLDivElement);

        // Apply dropRef (handle both callback and RefObject types)
        if (typeof dropRef === "function") {
          dropRef(node);
        } else if (dropRef) {
          (dropRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }

        // Store in containerRef for mouse tracking
        containerRef.current = node;
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      className={cn(
        "flex flex-col min-w-min border border-transparent rounded-[5px] relative cursor-grab active:cursor-grabbing",
        "[&>.overlay]:opacity-0 transition-opacity duration-200",
        !isDragging && "hover:[&>.overlay]:opacity-100"
      )}
    >
      {quantityArray.map((num, i) => {
        const draggedQuantity = draggedItem?.quantity ?? 1;
        const isCardDragging = isDragging && i >= entry.quantity - draggedQuantity;
        const isCardHighlighted = !isDragging && hoverIndex !== null && i >= hoverIndex;

        return (
          <div
            key={`${entry._id}-${num}`}
            className={cn(
              "shrink-0 pointer-events-none select-none transition-all duration-200",
              isCardDragging && "filter-[grayscale(20%)_brightness(50%)]",
              isCardHighlighted && "brightness-120 scale-[1.02]",
              isOver && "brightness-200"
            )}
            style={{
              width: `${CARD_WIDTH}px`,
              height: `${CARD_HEIGHT}px`,
              marginTop: i > 0 ? `-${CARD_HEIGHT - OVERLAP_OFFSET}px` : undefined
            }}
          >
            <SimpleCardArtView
              card={entry.card}
              variant="normal"
              width={CARD_WIDTH}
              height={CARD_HEIGHT}
            />
          </div>
        );
      })}

      <div className="overlay absolute top-[0] left-[0] right-[0] bottom-[0] flex flex-row items-start justify-end p-4 pointer-events-none select-none text-xl font-bold">
        <span className="bg-[rgba(0,0,0,0.6)] w-12 h-12 flex items-center justify-center rounded-full">
          {entry.quantity - hoverIndex!} / {entry.quantity}
        </span>
      </div>
    </div>
  );
}

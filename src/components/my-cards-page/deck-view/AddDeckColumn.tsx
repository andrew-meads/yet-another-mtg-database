import { CARD_WIDTH, CARD_HEIGHT } from "./card-dimensions";
import { useDragLayer } from "react-dnd";
import { cn } from "@/lib/utils";
import { CardCollectionWithCards } from "@/types/CardCollection";
import { useCollectionDropTarget } from "@/hooks/drag-drop/useCollectionDropTarget";
import { useUpdateCollectionCards } from "@/hooks/react-query/useUpdateCollectionCards";

interface AddDeckColumnProps {
  deck: CardCollectionWithCards;
}

export default function AddDeckColumn({ deck }: AddDeckColumnProps) {
  const index = deck?.cardsDetailed?.length || 0;

  const { isDraggingAnywhere, itemTypeAnywhere } = useDragLayer((monitor) => ({
    isDraggingAnywhere: monitor.isDragging(),
    itemTypeAnywhere: monitor.getItemType()
  }));

  const isRelevantItemDragging =
    isDraggingAnywhere && (itemTypeAnywhere === "CARD" || itemTypeAnywhere === "CARD_ENTRY");

  const { mutate: updateCardsInCollection } = useUpdateCollectionCards();

  const { dropRef, isOver } = useCollectionDropTarget({
    collection: deck,
    allowDrop: true,
    getDestinationIndex: () => index,
    onDrop: (payload) => {
      // If the payload is a CARD, we will use the "append" action to add it to the end of the deck
      if (payload.card) {
        updateCardsInCollection({
          collectionId: deck._id,
          action: "append",
          entry: {
            cardId: payload.card.id,
            quantity: payload.quantity || 1
          }
        });
        return;
      }

      return true;
    }
  });

  return (
    <div
      ref={dropRef}
      className={cn(
        "flex flex-col min-w-min rounded-[5px]",
        !isRelevantItemDragging && "border border-transparent",
        isRelevantItemDragging && !isOver && "border border-dashed",
        isOver && "border border-foreground"
      )}
    >
      <div
        className="shrink-0"
        style={{
          width: `${CARD_WIDTH}px`,
          height: `${CARD_HEIGHT}px`
        }}
      ></div>
    </div>
  );
}

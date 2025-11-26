import { useCollectionDropTarget } from "@/hooks/drag-drop/useCollectionDropTarget";
import { CARD_HEIGHT } from "./card-dimensions";
import { cn } from "@/lib/utils";
import { useDragLayer } from "react-dnd";
import { CardCollectionWithCards } from "@/types/CardCollection";

interface DropSeparatorProps {
  deck: CardCollectionWithCards;
  index: number;
}

export default function DropSeparator({ deck, index }: DropSeparatorProps) {
  const { isDraggingAnywhere, itemTypeAnywhere } = useDragLayer((monitor) => ({
    isDraggingAnywhere: monitor.isDragging(),
    itemTypeAnywhere: monitor.getItemType()
  }));

  const isRelevantItemDragging = isDraggingAnywhere && itemTypeAnywhere === "CARD_ENTRY";

  const { dropRef, isOver } = useCollectionDropTarget({
    collection: deck,
    allowDrop: (_, monitor) => monitor.getItemType() === "CARD_ENTRY",
    getDestinationIndex: () => index
  });

  return (
    <div
      ref={dropRef}
      className={cn(
        "min-w-min w-4 border border-transparent rounded-xs",
        index === 0 && "-ml-4 absolute",
        isRelevantItemDragging && "bg-foreground/20",
        isOver && "bg-foreground/80"
      )}
      style={{ height: `${CARD_HEIGHT}px` }}
    />
  );
}

import { CardCollectionWithCards } from "@/types/CardCollection";
import DeckColumn from "./DeckColumn";
import AddDeckColumn from "./AddDeckColumn";
import { Fragment } from "react/jsx-runtime";
import DropSeparator from "./DropSeparator";

interface DeckViewProps {
  deck: CardCollectionWithCards;
}

export default function DeckView({ deck }: DeckViewProps) {
  return (
    <div className="h-full rounded-md border overflow-auto flex flex-row flex-wrap items-start gap-y-4 content-start p-4">
      {deck.cardsDetailed.map((entry, index) => (
        <Fragment key={entry._id}>
          <DropSeparator deck={deck} index={index} />
          <DeckColumn deck={deck} entry={entry} index={index} />
          {index === deck.cardsDetailed.length - 1 && (
            <DropSeparator deck={deck} index={deck.cardsDetailed.length} />
          )}
        </Fragment>
      ))}

      <AddDeckColumn deck={deck} />
    </div>
  );
}

import { useCardLocations } from "@/hooks/react-query/useCardLocations";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MtgCard } from "@/types/MtgCard";
import { useMemo } from "react";
import { useCardSelection } from "@/context/CardSelectionContext";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Loc {
  key: string;
  collectionName: string;
  collectionId: string;
  card: MtgCard;
  tags: string[];
  quantity: number;
}

export default function CardLocationsView({ cardName }: { cardName: string }) {
  const { data: cardLocations, isLoading } = useCardLocations(cardName);
  const { selectedCard, setSelectedCard } = useCardSelection();
  const router = useRouter();

  const handleClick = (card: MtgCard) => {
    setSelectedCard(card);
  };

  const handleDoubleClick = (collectionId: string) => {
    router.push(`/my-cards/${collectionId}`);
  };

  const locations: Loc[] = useMemo(() => {
    if (!cardLocations?.locations) return [];

    return cardLocations.locations.flatMap((loc) =>
      loc.cards.map((entry) => ({
        key: `${loc.collectionId}-${entry._id}`,
        collectionName: loc.collectionName,
        collectionId: loc.collectionId,
        card: entry.card,
        tags: entry.tags || [],
        quantity: entry.quantity
      }))
    );
  }, [cardLocations]);

  return (
    <div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading locations...</p>}
      {!isLoading && locations.length === 0 && (
        <p className="text-sm text-muted-foreground">No locations found</p>
      )}
      {locations.length > 0 && (
        <Table stickyHeader>
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead className="text-center">Set</TableHead>
              <TableHead className="text-center">Tags</TableHead>
              <TableHead className="text-center">Qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {locations.map((loc) => {
              const isSelected = selectedCard?.id === loc.card.id;
              return (
                <TableRow
                  key={loc.key}
                  className={cn(
                    "cursor-pointer",
                    isSelected && "bg-primary/10 hover:bg-primary/15"
                  )}
                  onClick={() => handleClick(loc.card)}
                  onDoubleClick={() => handleDoubleClick(loc.collectionId)}
                >
                  <TableCell>{loc.collectionName}</TableCell>
                  <TableCell className="text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default">{loc.card.set.toUpperCase()}</span>
                      </TooltipTrigger>
                      <TooltipContent>{loc.card.set_name || loc.card.set}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-center">
                    {loc.tags.length > 0 ? loc.tags.join(", ") : "—"}
                  </TableCell>
                  <TableCell className="text-center">{loc.quantity}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

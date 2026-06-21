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
import { useMemo, useState } from "react";
import { useCardSelection } from "@/context/CardSelectionContext";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Library, Layers } from "lucide-react";
import { SetSvg } from "@/components/SetSvg";

interface Loc {
  key: string;
  type: "collection" | "deck";
  locationName: string;
  locationId: string;
  card: MtgCard;
  notes: string;
  tags: string[];
  quantity: number;
  freeQuantity: number;
}

export default function CardLocationsView({ cardName }: { cardName: string }) {
  const { data: cardLocations, isLoading } = useCardLocations(cardName);
  const { setSelectedCard } = useCardSelection();
  const router = useRouter();

  const [selection, setSelection] = useState<{ cardName: string; key: string } | null>(null);

  const handleClick = (loc: Loc) => {
    setSelectedCard(loc.card);
    setSelection({ cardName, key: loc.key });
  };

  const handleDoubleClick = (loc: Loc) => {
    if (loc.type === "collection") {
      router.push(`/my-cards/collections/${loc.locationId}`);
    } else {
      router.push(`/my-cards/decks/${loc.locationId}`);
    }
  };

  const locations: Loc[] = useMemo(() => {
    if (!cardLocations?.locations) return [];

    const collectionMap = new Map<string, Loc>();
    const deckMap = new Map<string, Loc>();

    for (const loc of cardLocations.locations) {
      for (const entry of loc.cards) {
        const notes = entry.notes ?? "";
        const tags = [...(entry.tags ?? [])].sort();
        const tagsKey = tags.join(",");

        const collKey = `coll-${loc.collectionId}-${entry.card.id}-${notes}-${tagsKey}`;
        const existing = collectionMap.get(collKey);
        if (existing) {
          existing.quantity++;
          if (!entry.deckId) existing.freeQuantity++;
        } else {
          collectionMap.set(collKey, {
            key: collKey,
            type: "collection",
            locationName: loc.collectionName,
            locationId: loc.collectionId,
            card: entry.card,
            notes,
            tags,
            quantity: 1,
            freeQuantity: entry.deckId ? 0 : 1
          });
        }

        if (entry.deckId) {
          const deckKey = `deck-${entry.deckId}-${entry.card.id}-${notes}-${tagsKey}`;
          const existingDeck = deckMap.get(deckKey);
          if (existingDeck) {
            existingDeck.quantity++;
          } else {
            deckMap.set(deckKey, {
              key: deckKey,
              type: "deck",
              locationName: entry.deckName ?? "",
              locationId: entry.deckId,
              card: entry.card,
              notes,
              tags,
              quantity: 1,
              freeQuantity: 0
            });
          }
        }
      }
    }

    return [...collectionMap.values(), ...deckMap.values()];
  }, [cardLocations]);

  const totalQuantity = locations
    .filter((l) => l.type === "collection")
    .reduce((sum, l) => sum + l.quantity, 0);
  const totalFree = locations
    .filter((l) => l.type === "collection")
    .reduce((sum, l) => sum + l.freeQuantity, 0);

  return (
    <div>
      {isLoading && <p className="text-muted-foreground text-sm">Loading locations...</p>}
      {!isLoading && locations.length === 0 && (
        <p className="text-muted-foreground text-sm">No locations found</p>
      )}
      {locations.length > 0 && (
        <>
          <p className="text-muted-foreground mb-2 text-sm">
            {totalQuantity} {totalQuantity === 1 ? "copy" : "copies"} total
            {totalFree < totalQuantity && `, ${totalFree} free`}
          </p>
          <Table stickyHeader>
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead className="text-center">Set</TableHead>
              <TableHead className="text-center">Notes</TableHead>
              <TableHead className="text-center">Tags</TableHead>
              <TableHead className="text-center">Qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {locations.map((loc) => {
              const isSelected = selection?.cardName === cardName && selection?.key === loc.key;
              const qtyLabel =
                loc.type === "collection" && loc.freeQuantity < loc.quantity
                  ? `${loc.quantity} (${loc.freeQuantity} free)`
                  : `${loc.quantity}`;
              return (
                <TableRow
                  key={loc.key}
                  className={cn(
                    "cursor-pointer",
                    isSelected && "bg-primary/10 hover:bg-primary/15"
                  )}
                  onClick={() => handleClick(loc)}
                  onDoubleClick={() => handleDoubleClick(loc)}
                >
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      {loc.type === "collection" ? (
                        <Library className="text-muted-foreground size-3.5 shrink-0" />
                      ) : (
                        <Layers className="text-muted-foreground size-3.5 shrink-0" />
                      )}
                      {loc.locationName}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="inline-flex items-center justify-center">
                          <SetSvg setCode={loc.card.set} rarityCode={loc.card.rarity} width={22} height={22} />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        {loc.card.set_name}{" "}
                        <em className="text-muted-foreground text-xs">({loc.card.set.toUpperCase()})</em>{" "}
                        {loc.card.rarity}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-center">{loc.notes || "—"}</TableCell>
                  <TableCell className="text-center">
                    {loc.tags.length > 0 ? loc.tags.join(", ") : "—"}
                  </TableCell>
                  <TableCell className="text-center">{qtyLabel}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </>
      )}
    </div>
  );
}

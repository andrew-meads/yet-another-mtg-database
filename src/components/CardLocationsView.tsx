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
import { SlimMtgCard } from "@/types/MtgCard";
import { useMemo, useState } from "react";
import { useCardSelection } from "@/context/CardSelectionContext";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Library, Layers } from "lucide-react";
import { SetSvg } from "@/components/SetSvg";
import CardAttributeBadges from "@/components/CardAttributeBadges";
import { SelectedCopies } from "@/context/CardSelectionContext";
import { copySetFromCopies } from "@/lib/copyPricing";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import {
  CardCondition,
  CardFinish,
  attributesKey,
  conditionRank,
  effectiveCondition,
  effectiveFinish,
  finishRank
} from "@/lib/cardAttributes";

interface Loc {
  key: string;
  type: "collection" | "deck";
  locationName: string;
  locationId: string;
  card: SlimMtgCard;
  notes: string;
  tags: string[];
  finish: CardFinish;
  condition: CardCondition;
  quantity: number;
  freeQuantity: number;
  /** The copies behind this row, so clicking it selects them with the card. */
  copies: DetailedPhysicalCard[];
}

export default function CardLocationsView({ cardName }: { cardName: string }) {
  const { data: cardLocations, isLoading } = useCardLocations(cardName);
  const { setSelectedCard } = useCardSelection();
  const router = useRouter();

  const [selection, setSelection] = useState<{ cardName: string; key: string } | null>(null);

  const handleClick = (loc: Loc) => {
    const copies: SelectedCopies = {
      cardId: loc.card.id,
      physicalCardIds: loc.copies.map((c) => c._id),
      ...copySetFromCopies(loc.copies),
      locationName: loc.locationName
    };
    setSelectedCard(loc.card, copies);
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

    // Set release-date order (oldest first, matching the app-wide set sort),
    // then set code, deck name, finish/condition, and notes/tags for determinism.
    const compareLocs = (a: Loc, b: Loc) => {
      const dateCmp = (a.card.released_at ?? "").localeCompare(b.card.released_at ?? "");
      if (dateCmp !== 0) return dateCmp;
      const setCmp = a.card.set.localeCompare(b.card.set);
      if (setCmp !== 0) return setCmp;
      const nameCmp = a.locationName.localeCompare(b.locationName);
      if (nameCmp !== 0) return nameCmp;
      const finishCmp = finishRank(a.finish) - finishRank(b.finish);
      if (finishCmp !== 0) return finishCmp;
      const conditionCmp = conditionRank(a.condition) - conditionRank(b.condition);
      if (conditionCmp !== 0) return conditionCmp;
      const notesCmp = a.notes.localeCompare(b.notes);
      if (notesCmp !== 0) return notesCmp;
      return a.tags.join(",").localeCompare(b.tags.join(","));
    };

    // Each deck row is a child of exactly one collection row — the one sharing
    // its (collection, printing, finish, condition, notes, tags) — and is rendered (indented)
    // directly beneath it.
    const result: Loc[] = [];
    for (const loc of cardLocations.locations) {
      const collectionMap = new Map<string, Loc>();
      // Parent collection-row key -> that row's deck children.
      const deckChildren = new Map<string, Map<string, Loc>>();

      for (const entry of loc.cards) {
        const notes = entry.notes ?? "";
        const tags = [...(entry.tags ?? [])].sort();
        const tagsKey = tags.join(",");
        const finish = effectiveFinish(entry.finish);
        const condition = effectiveCondition(entry.condition);
        const attrs = attributesKey(finish, condition);

        const collKey = `coll-${loc.collectionId}-${entry.card.id}-${attrs}-${notes}-${tagsKey}`;
        const existing = collectionMap.get(collKey);
        if (existing) {
          existing.quantity++;
          existing.copies.push(entry);
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
            finish,
            condition,
            quantity: 1,
            freeQuantity: entry.deckId ? 0 : 1,
            copies: [entry]
          });
        }

        if (entry.deckId) {
          const deckKey = `deck-${loc.collectionId}-${entry.deckId}-${entry.card.id}-${attrs}-${notes}-${tagsKey}`;
          let children = deckChildren.get(collKey);
          if (!children) {
            children = new Map();
            deckChildren.set(collKey, children);
          }
          const existingDeck = children.get(deckKey);
          if (existingDeck) {
            existingDeck.quantity++;
            existingDeck.copies.push(entry);
          } else {
            children.set(deckKey, {
              key: deckKey,
              type: "deck",
              locationName: entry.deckName ?? "",
              locationId: entry.deckId,
              card: entry.card,
              notes,
              tags,
              finish,
              condition,
              quantity: 1,
              freeQuantity: 0,
              copies: [entry]
            });
          }
        }
      }

      for (const collRow of [...collectionMap.values()].sort(compareLocs)) {
        result.push(collRow);
        const children = deckChildren.get(collRow.key);
        if (children) result.push(...[...children.values()].sort(compareLocs));
      }
    }
    return result;
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
                <TableHead className="text-center">Finish</TableHead>
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
                      {/* Deck rows sit under their owning collection; indent them to show the nesting. */}
                      <span
                        className={cn("flex items-center gap-1.5", loc.type === "deck" && "pl-5")}
                      >
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
                            <SetSvg
                              setCode={loc.card.set}
                              rarityCode={loc.card.rarity}
                              width={22}
                              height={22}
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          {loc.card.set_name}{" "}
                          <em className="text-muted-foreground text-xs">
                            ({loc.card.set.toUpperCase()})
                          </em>{" "}
                          {loc.card.rarity}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-center">
                      <CardAttributeBadges finish={loc.finish} condition={loc.condition} />
                      {loc.finish === "nonfoil" && loc.condition === "NM" && "—"}
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

"use client";

import { useCardLocations } from "@/hooks/react-query/useCardLocations";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SlimMtgCard } from "@/types/MtgCard";
import { useMemo, useState } from "react";
import { useCardSelection } from "@/context/CardSelectionContext";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Library, Layers, SquareArrowOutUpRight } from "lucide-react";
import { SetSvg } from "@/components/SetSvg";
import CardAttributeBadges from "@/components/CardAttributeBadges";
import { SelectedCopies } from "@/context/CardSelectionContext";
import {
  ESTIMATED_PRICE_DESCRIPTION,
  copyPriceView,
  copySetFromCopies,
  describeCopyPriceView
} from "@/lib/copyPricing";
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
import { quoteForCard, useCardPriceQuotes } from "@/hooks/react-query/useCardPriceQuotes";
import { useCurrency } from "@/hooks/useCurrency";
import PriceAgeDot from "@/components/pricing/PriceAgeDot";
import RefreshPriceButton from "@/components/pricing/RefreshPriceButton";

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

/**
 * Where the user's copies of a card live, as a compact list built for a narrow
 * column: one row per (collection, printing, finish, condition, notes, tags)
 * group, its deck rows nested beneath it. The first line carries the location
 * and the count; the second the printing (set icon + code), any non-default
 * finish/condition badges, tags and notes — nothing is padded out with "—"
 * placeholders — and the copies' price (their own finish + condition price
 * when fetched, else the printing's price marked as an estimate, or $0 for a
 * proxy; the same decision as the collection row cell). Clicking a row selects
 * the card **with those copies**; the open icon navigates to the entity.
 */
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

  const handleOpen = (loc: Loc) => {
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

  // Quotes for every printing listed, so each collection row can show its copies' price.
  const cardIds = useMemo(() => [...new Set(locations.map((l) => l.card.id))].sort(), [locations]);
  const { quotes } = useCardPriceQuotes(cardIds);

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading locations...</p>;
  }
  if (locations.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">You don&apos;t own any copies of this card.</p>
    );
  }

  return (
    <div role="list" className="flex flex-col gap-0.5 text-sm" data-testid="card-locations">
      {locations.map((loc) => {
        const isSelected = selection?.cardName === cardName && selection?.key === loc.key;
        const isDeck = loc.type === "deck";
        const qtyLabel =
          loc.type === "collection" && loc.freeQuantity < loc.quantity
            ? `${loc.quantity} (${loc.freeQuantity} free)`
            : `${loc.quantity}`;
        const hasDetails =
          loc.finish !== "nonfoil" ||
          loc.condition !== "NM" ||
          loc.tags.length > 0 ||
          loc.notes !== "";
        return (
          <div
            key={loc.key}
            role="listitem"
            data-testid="card-location-row"
            data-location-type={loc.type}
            data-selected={isSelected || undefined}
            className={cn(
              "group hover:bg-muted/60 flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5",
              isDeck && "ml-5",
              isSelected && "bg-primary/10 hover:bg-primary/15"
            )}
            onClick={() => handleClick(loc)}
          >
            {/* Line 1: location + count + open */}
            <div className="flex items-center gap-1.5">
              {isDeck ? (
                <Layers className="text-muted-foreground size-3.5 shrink-0" aria-label="Deck" />
              ) : (
                <Library
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-label="Collection"
                />
              )}
              <span className="min-w-0 flex-1 truncate font-medium" title={loc.locationName}>
                {loc.locationName}
              </span>
              <span
                className="text-muted-foreground shrink-0 text-xs tabular-nums"
                data-testid="card-location-qty"
              >
                {qtyLabel}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Open ${isDeck ? "deck" : "collection"} ${loc.locationName}`}
                    className="text-muted-foreground/50 hover:text-foreground focus-visible:ring-ring inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded focus-visible:ring-1 focus-visible:outline-none"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpen(loc);
                    }}
                  >
                    <SquareArrowOutUpRight className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Open {isDeck ? "deck" : "collection"}</TooltipContent>
              </Tooltip>
            </div>

            {/* Line 2 (collection rows only — deck rows share their parent's printing): set,
                non-default attributes, tags, notes, and the copies' price. */}
            {!isDeck && (
              <div className="text-muted-foreground flex min-w-0 items-center gap-x-2 pl-5 text-xs">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <SetSvg
                          setCode={loc.card.set}
                          rarityCode={loc.card.rarity}
                          width={16}
                          height={16}
                        />
                        <span className="uppercase">{loc.card.set}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {loc.card.set_name}{" "}
                      <em className="text-muted-foreground text-xs">
                        ({loc.card.set.toUpperCase()})
                      </em>{" "}
                      {loc.card.rarity}
                    </TooltipContent>
                  </Tooltip>
                  {hasDetails && (
                    <>
                      <CardAttributeBadges finish={loc.finish} condition={loc.condition} />
                      {loc.tags.map((tag) => (
                        <span
                          key={tag}
                          className="bg-secondary text-secondary-foreground rounded px-1 leading-4"
                          data-testid="card-location-tag"
                        >
                          {tag}
                        </span>
                      ))}
                      {loc.notes && (
                        <span className="truncate italic" title={loc.notes}>
                          {loc.notes}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <LocationPrice loc={loc} quotes={quotes} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The copies' unit price for a collection row, with its age dot and a refresh for those copies. */
function LocationPrice({
  loc,
  quotes
}: {
  loc: Loc;
  quotes: ReturnType<typeof useCardPriceQuotes>["quotes"];
}) {
  const { format, currency } = useCurrency();
  const set = copySetFromCopies(loc.copies);
  const view = copyPriceView(set, quoteForCard(loc.card, quotes));
  const text = view.usd === null ? "—" : format(view.usd);
  const description =
    view.kind === "proxy"
      ? `Proxy — counted as ${format(0)} regardless of market prices`
      : describeCopyPriceView(view, set, currency);

  return (
    <span
      className="text-foreground inline-flex shrink-0 items-center gap-1 tabular-nums"
      data-testid="card-location-price"
      data-price-kind={view.kind}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{text}</span>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
      {view.kind === "copy" && <PriceAgeDot updatedAt={view.updatedAt} />}
      {view.kind === "estimate" && (
        <PriceAgeDot
          updatedAt={view.updatedAt}
          override={{ level: "stale", description: ESTIMATED_PRICE_DESCRIPTION }}
        />
      )}
      {view.kind !== "proxy" && (
        <RefreshPriceButton physicalCardIds={loc.copies.map((c) => c._id)} />
      )}
    </span>
  );
}

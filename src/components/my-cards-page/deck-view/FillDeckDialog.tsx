"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import { useRetrieveCollectionDetails } from "@/hooks/react-query/useRetrieveCollectionDetails";
import { useFillDeck } from "@/hooks/react-query/useFillDeck";
import { assignSwaps, buildFillGroups } from "@/lib/fillDeck";
import { DeckWithCards } from "@/types/Deck";

interface FillDeckDialogProps {
  deck: DeckWithCards;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog that fills a deck's ephemeral placeholders from the active collection.
 * Each placeholder card is matched against the collection's unassigned real
 * copies (same printing prioritized, other printings of the same card allowed);
 * the selected copies replace their placeholders in place.
 */
export default function FillDeckDialog({ deck, open, onOpenChange }: FillDeckDialogProps) {
  const { activeCollection } = useOpenEntitiesContext();
  // Only fetch while the dialog is open.
  const { data, isLoading, isError } = useRetrieveCollectionDetails(
    open ? (activeCollection?._id ?? null) : null
  );
  const fillDeck = useFillDeck();

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Clear the selection whenever the dialog closes (adjust-state-in-render, as
  // in NewCollectionDialog).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setSelected(new Set());
  }

  const collectionCards = data?.collection.cards;
  const groups = useMemo(
    () => (collectionCards ? buildFillGroups(deck, collectionCards) : []),
    [deck, collectionCards]
  );

  const toggle = (physicalCardId: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(physicalCardId);
      else next.delete(physicalCardId);
      return next;
    });

  const totalSelected = selected.size;

  const handleConfirm = async () => {
    const swaps = groups.flatMap((group) =>
      assignSwaps(
        group,
        group.candidates
          .map((c) => c.physicalCard._id)
          .filter((cardId) => selected.has(cardId))
      )
    );
    if (swaps.length === 0) return;

    try {
      const { filled } = await fillDeck.mutateAsync({ deckId: deck._id, swaps });
      toast.success("Deck filled", {
        description: `Replaced ${filled} ${filled === 1 ? "placeholder" : "placeholders"} with ${
          filled === 1 ? "a card" : "cards"
        } from ${activeCollection?.name ?? "the collection"}.`
      });
      setSelected(new Set());
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to fill deck", {
        description: err instanceof Error ? err.message : "An error occurred."
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" data-testid="fill-deck-dialog">
        <DialogHeader>
          <DialogTitle>Fill Deck</DialogTitle>
          <DialogDescription>
            {activeCollection
              ? `Replace this deck's placeholder cards with real copies from ${activeCollection.name}.`
              : "Replace this deck's placeholder cards with real copies from your active collection."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto py-2">
          {!activeCollection && (
            <p className="text-muted-foreground text-sm">
              Set an active collection to fill this deck from.
            </p>
          )}
          {activeCollection && isLoading && (
            <p className="text-muted-foreground text-sm">Loading collection…</p>
          )}
          {activeCollection && isError && (
            <p className="text-destructive text-sm">Failed to load the active collection.</p>
          )}
          {activeCollection && !isLoading && !isError && groups.length === 0 && (
            <p className="text-muted-foreground text-sm">
              This deck has no ephemeral cards to fill.
            </p>
          )}
          {groups.map((group) => {
            const selectedInGroup = group.candidates.filter((c) =>
              selected.has(c.physicalCard._id)
            ).length;
            const capReached = selectedInGroup >= group.ephemerals.length;
            return (
              <div key={group.key} data-testid={`fill-group-${group.key}`}>
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-sm font-medium">{group.card.name}</span>
                  <span className="text-muted-foreground text-xs">
                    needs {group.ephemerals.length}
                  </span>
                </div>
                {group.candidates.length === 0 ? (
                  <p className="text-muted-foreground ml-1 text-xs">
                    No matching cards in {activeCollection?.name ?? "the collection"}.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {group.candidates.map(({ physicalCard, samePrinting }) => {
                      const isChecked = selected.has(physicalCard._id);
                      return (
                        <label
                          key={physicalCard._id}
                          className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-sm p-1"
                        >
                          <Checkbox
                            checked={isChecked}
                            disabled={!isChecked && capReached}
                            onCheckedChange={(checked) =>
                              toggle(physicalCard._id, checked === true)
                            }
                            data-testid={`fill-candidate-${physicalCard._id}`}
                          />
                          <div className="min-w-0 flex-1 text-sm">
                            <div>
                              {physicalCard.card.set_name}{" "}
                              <span className="text-muted-foreground text-xs">
                                ({physicalCard.card.set.toUpperCase()}) #
                                {physicalCard.card.collector_number}
                              </span>
                            </div>
                            {physicalCard.tags && physicalCard.tags.length > 0 && (
                              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                                <Tag className="size-3 shrink-0" />
                                <span className="truncate">{physicalCard.tags.join(", ")}</span>
                              </div>
                            )}
                          </div>
                          {samePrinting && (
                            <span className="text-muted-foreground flex items-center gap-1 text-xs">
                              <Sparkles className="size-3" />
                              Same printing
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={fillDeck.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={totalSelected === 0 || fillDeck.isPending || !activeCollection}
            data-testid="fill-deck-confirm"
          >
            {fillDeck.isPending
              ? "Adding…"
              : totalSelected > 0
                ? `Add ${totalSelected} to deck`
                : "Add to deck"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Minus, Trees } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SimpleCardArtView } from "@/components/CardArtView";
import { useBasicLands } from "@/hooks/react-query/useBasicLands";
import { useCreatePhysicalCard } from "@/hooks/react-query/useCreatePhysicalCard";
import { useAddColumn } from "@/hooks/react-query/useDeckColumns";

interface AddBasicLandButtonProps {
  deckId: string;
  sectionId: string;
}

/**
 * Per-section control to add ephemeral basic lands to a deck. Each land type with
 * a positive quantity is placed into its own new column in this section (so the
 * copies form a neat stack). The created cards have no collection (ephemeral) —
 * they live only in this deck and are deleted when removed.
 */
export default function AddBasicLandButton({ deckId, sectionId }: AddBasicLandButtonProps) {
  const { data, isLoading, isError } = useBasicLands();
  const addColumn = useAddColumn();
  const createCard = useCreatePhysicalCard();

  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const lands = data?.cards ?? [];

  const setQty = (id: string, value: number) =>
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, Math.min(99, value)) }));

  const total = Object.values(quantities).reduce((sum, n) => sum + n, 0);

  const handleAdd = async () => {
    const selected = lands.filter((land) => (quantities[land.id] ?? 0) > 0);
    if (selected.length === 0) return;

    setSubmitting(true);
    try {
      for (const land of selected) {
        const quantity = quantities[land.id];
        // Each land type gets its own new column so the copies stack together.
        const { columnId } = await addColumn.mutateAsync({ deckId, sectionId });
        await createCard.mutateAsync({
          cardId: land.id,
          deckId,
          sectionId,
          columnId,
          quantity
        });
      }
      toast.success("Lands added", {
        description: `Added ${total} ${total === 1 ? "land" : "lands"} to the deck.`
      });
      setQuantities({});
      setOpen(false);
    } catch (err) {
      toast.error("Failed to add lands", {
        description: err instanceof Error ? err.message : "An error occurred."
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1" data-testid="add-land-button">
          <Trees className="size-4" />
          Add land
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start" data-testid="add-land-popover">
        {isLoading && <p className="text-muted-foreground text-sm">Loading lands…</p>}
        {isError && <p className="text-destructive text-sm">Failed to load basic lands.</p>}
        {!isLoading && !isError && lands.length === 0 && (
          <p className="text-muted-foreground text-sm">No basic lands available.</p>
        )}
        {lands.length > 0 && (
          <div className="space-y-3">
            {lands.map((land) => {
              const qty = quantities[land.id] ?? 0;
              return (
                <div key={land.id} className="flex items-center gap-2">
                  <div className="h-14 w-10 shrink-0 overflow-hidden rounded-sm bg-muted">
                    <SimpleCardArtView card={land} variant="small" width="100%" height="100%" />
                  </div>
                  <span className="flex-1 text-sm font-medium">{land.name}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-7"
                      aria-label={`Decrease ${land.name}`}
                      onClick={() => setQty(land.id, qty - 1)}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <Input
                      type="number"
                      min={0}
                      max={99}
                      value={qty}
                      aria-label={`${land.name} quantity`}
                      data-testid={`land-qty-${land.name}`}
                      onChange={(e) => setQty(land.id, Number(e.target.value) || 0)}
                      className="h-7 w-16 px-1 text-center"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-7"
                      aria-label={`Increase ${land.name}`}
                      onClick={() => setQty(land.id, qty + 1)}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button
              className="w-full"
              disabled={total === 0 || submitting}
              data-testid="add-land-confirm"
              onClick={handleAdd}
            >
              {submitting ? "Adding…" : total > 0 ? `Add ${total}` : "Add"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

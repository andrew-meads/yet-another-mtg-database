"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, CircleAlert, ClipboardList, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import { useRetrieveDeckDetails } from "@/hooks/react-query/useRetrieveDeckDetails";
import { useCreatePhysicalCard } from "@/hooks/react-query/useCreatePhysicalCard";
import { useDeckCardOp } from "@/hooks/react-query/useDeckCardOp";

/** The proposal shape echoed by the proposeDeckChanges tool. */
export interface DeckChangeProposal {
  deckId: string;
  deckName: string;
  rationale: string;
  changes: Array<{
    action: "add" | "remove" | "move";
    cardName: string;
    cardId: string;
    count: number;
    sectionName?: string;
    sectionId?: string;
    ephemeral?: boolean;
  }>;
}

type ChangeStatus = "pending" | "applying" | "applied" | "failed";

function changeLabel(change: DeckChangeProposal["changes"][number]): string {
  const copies = `${change.count}x ${change.cardName}`;
  switch (change.action) {
    case "add":
      return `Add ${copies}${change.sectionName ? ` to ${change.sectionName}` : ""}${change.ephemeral ? " (placeholder)" : ""}`;
    case "remove":
      return `Remove ${copies}${change.sectionName ? ` from ${change.sectionName}` : ""}`;
    case "move":
      return `Move ${copies} to ${change.sectionName}`;
  }
}

function ActionIcon({ action }: { action: DeckChangeProposal["changes"][number]["action"] }) {
  if (action === "add") return <Plus className="size-3 shrink-0 text-green-600 dark:text-green-500" />;
  if (action === "remove") return <Minus className="size-3 shrink-0 text-red-600 dark:text-red-500" />;
  return <ArrowRight className="size-3 shrink-0 text-blue-600 dark:text-blue-500" />;
}

/**
 * Renders a validated deck-change proposal from the AI as a checklist with an
 * Apply button. Applying calls the app's existing mutation hooks
 * ({@link useCreatePhysicalCard} / {@link useDeckCardOp}), so ownership checks,
 * ephemeral-card semantics, and cache invalidation are exactly the normal
 * write path — the AI itself never writes anything.
 */
export default function ProposalCard({ proposal }: { proposal: DeckChangeProposal }) {
  const { activeCollection } = useOpenEntitiesContext();
  const { data: deckData } = useRetrieveDeckDetails(proposal.deckId);
  const createPhysicalCard = useCreatePhysicalCard();
  const deckCardOp = useDeckCardOp();

  const [selected, setSelected] = useState<boolean[]>(() => proposal.changes.map(() => true));
  const [statuses, setStatuses] = useState<ChangeStatus[]>(() =>
    proposal.changes.map(() => "pending")
  );
  const [applying, setApplying] = useState(false);

  const done = statuses.every((s) => s === "applied" || s === "failed");
  const anySelected = selected.some((s, i) => s && statuses[i] === "pending");

  /** Flat view of the deck's copies: physical id, card name, section id. */
  const deckEntries = useMemo(() => {
    const entries: { _id: string; name: string; sectionId: string }[] = [];
    for (const section of deckData?.deck.sections ?? []) {
      for (const column of section.columns) {
        for (const card of column.cards) {
          entries.push({ _id: card._id, name: card.card.name, sectionId: section._id });
        }
      }
    }
    return entries;
  }, [deckData]);

  const setStatus = (index: number, status: ChangeStatus) =>
    setStatuses((prev) => prev.map((s, i) => (i === index ? status : s)));

  const applyChange = async (change: DeckChangeProposal["changes"][number]) => {
    if (change.action === "add") {
      if (!change.ephemeral && !activeCollection) {
        throw new Error("Set an active collection first (or ask for placeholder copies).");
      }
      await createPhysicalCard.mutateAsync({
        cardId: change.cardId,
        collectionId: change.ephemeral ? undefined : activeCollection!._id,
        deckId: proposal.deckId,
        sectionId: change.sectionId,
        quantity: change.count
      });
      return;
    }

    // remove / move: resolve concrete copies in the deck by card name.
    const nameKey = change.cardName.toLowerCase();
    const candidates = deckEntries.filter((entry) => {
      if (entry.name.toLowerCase() !== nameKey) return false;
      if (change.action === "remove") {
        // Optional section filter for removes.
        return !change.sectionId || entry.sectionId === change.sectionId;
      }
      // Moving a copy already in the target section is a no-op — skip those.
      return entry.sectionId !== change.sectionId;
    });
    if (candidates.length < change.count) {
      throw new Error(`Only ${candidates.length} matching cop${candidates.length === 1 ? "y" : "ies"} of ${change.cardName} in the deck — it may have changed since the proposal.`);
    }
    for (const entry of candidates.slice(0, change.count)) {
      await deckCardOp.mutateAsync(
        change.action === "remove"
          ? { deckId: proposal.deckId, op: "remove", physicalCardId: entry._id }
          : {
              deckId: proposal.deckId,
              op: "move",
              physicalCardId: entry._id,
              sectionId: change.sectionId
            }
      );
    }
  };

  const handleApply = async () => {
    setApplying(true);
    let applied = 0;
    let failed = 0;
    for (const [index, change] of proposal.changes.entries()) {
      if (!selected[index] || statuses[index] !== "pending") continue;
      setStatus(index, "applying");
      try {
        await applyChange(change);
        setStatus(index, "applied");
        applied += 1;
      } catch (error) {
        setStatus(index, "failed");
        failed += 1;
        toast.error(`${changeLabel(change)} failed`, {
          description: error instanceof Error ? error.message : "An error occurred."
        });
      }
    }
    setApplying(false);
    if (applied > 0) {
      toast.success(
        `Applied ${applied} change${applied === 1 ? "" : "s"} to ${proposal.deckName}` +
          (failed > 0 ? ` (${failed} failed)` : "")
      );
    }
  };

  return (
    <div className="bg-muted/30 rounded-md border p-3 text-sm" data-testid="proposal-card">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold">
        <ClipboardList className="size-4 shrink-0" />
        Proposed changes to {proposal.deckName}
      </div>
      <p className="text-muted-foreground mb-2 text-xs">{proposal.rationale}</p>

      <div className="space-y-1.5">
        {proposal.changes.map((change, index) => (
          <label
            key={index}
            className={cn(
              "flex cursor-pointer items-center gap-2",
              statuses[index] !== "pending" && "cursor-default"
            )}
            data-testid="proposal-change"
          >
            <Checkbox
              checked={selected[index]}
              disabled={applying || statuses[index] !== "pending"}
              onCheckedChange={(checked) =>
                setSelected((prev) => prev.map((s, i) => (i === index ? checked === true : s)))
              }
              aria-label={changeLabel(change)}
            />
            <ActionIcon action={change.action} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                statuses[index] === "applied" && "text-muted-foreground line-through"
              )}
            >
              {changeLabel(change)}
            </span>
            {statuses[index] === "applying" && <Loader2 className="size-3.5 animate-spin" />}
            {statuses[index] === "applied" && (
              <Check className="size-3.5 text-green-600 dark:text-green-500" />
            )}
            {statuses[index] === "failed" && <CircleAlert className="text-destructive size-3.5" />}
          </label>
        ))}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {done ? "Done — ask for a new proposal to make further changes." : "Nothing is changed until you apply."}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={handleApply}
          disabled={applying || done || !anySelected || !deckData}
        >
          {applying && <Loader2 className="animate-spin" />}
          Apply
        </Button>
      </div>
    </div>
  );
}

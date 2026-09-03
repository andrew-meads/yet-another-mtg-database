"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  CircleAlert,
  CircleSlash,
  ClipboardList,
  Loader2,
  Minus,
  Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import { useRetrieveDeckDetails } from "@/hooks/react-query/useRetrieveDeckDetails";
import { useRetrieveCollectionDetails } from "@/hooks/react-query/useRetrieveCollectionDetails";
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
    /** For adds: the native-language printing to use for placeholder copies. */
    cardId: string;
    count: number;
    sectionName?: string;
    sectionId?: string;
  }>;
}

type Change = DeckChangeProposal["changes"][number];
type ChangeStatus = "pending" | "applying" | "applied" | "failed" | "skipped";

/** Per added card, the user picks how (or whether) it enters the deck. */
export type AddMode = "collection" | "ephemeral" | "skip";

function changeLabel(change: Change): string {
  const copies = `${change.count}x ${change.cardName}`;
  switch (change.action) {
    case "add":
      return `Add ${copies}${change.sectionName ? ` to ${change.sectionName}` : ""}`;
    case "remove":
      return `Remove ${copies}${change.sectionName ? ` from ${change.sectionName}` : ""}`;
    case "move":
      return `Move ${copies} to ${change.sectionName}`;
  }
}

function ActionIcon({ action }: { action: Change["action"] }) {
  if (action === "add") return <Plus className="size-3 shrink-0 text-green-600 dark:text-green-500" />;
  if (action === "remove") return <Minus className="size-3 shrink-0 text-red-600 dark:text-red-500" />;
  return <ArrowRight className="size-3 shrink-0 text-blue-600 dark:text-blue-500" />;
}

function StatusIcon({ status }: { status: ChangeStatus }) {
  if (status === "applying") return <Loader2 className="size-3.5 animate-spin" />;
  if (status === "applied") return <Check className="size-3.5 text-green-600 dark:text-green-500" />;
  if (status === "failed") return <CircleAlert className="text-destructive size-3.5" />;
  if (status === "skipped") return <CircleSlash className="text-muted-foreground size-3.5" />;
  return null;
}

/**
 * Renders a validated deck-change proposal from the AI as a checklist with an
 * Apply button. For each ADDED card the user chooses per card: place real
 * copies already sitting unassigned in their active collection (no new copies
 * are created), create ephemeral placeholder copies, or skip it. Removes and
 * moves keep a simple include/exclude checkbox.
 *
 * Applying calls the app's existing mutation hooks
 * ({@link useDeckCardOp} place/remove/move, {@link useCreatePhysicalCard} for
 * placeholders), so ownership checks, ephemeral-card semantics, and cache
 * invalidation are exactly the normal write path — the AI itself never writes
 * anything.
 */
export default function ProposalCard({ proposal }: { proposal: DeckChangeProposal }) {
  const { activeCollection } = useOpenEntitiesContext();
  const { data: deckData } = useRetrieveDeckDetails(proposal.deckId);
  const { data: collectionData } = useRetrieveCollectionDetails(activeCollection?._id ?? null);
  const createPhysicalCard = useCreatePhysicalCard();
  const deckCardOp = useDeckCardOp();

  // remove/move rows: include/exclude. add rows are governed by addModes.
  const [selected, setSelected] = useState<boolean[]>(() => proposal.changes.map(() => true));
  // null = "no explicit choice yet" — the effective mode falls back to a default.
  const [addModes, setAddModes] = useState<(AddMode | null)[]>(() =>
    proposal.changes.map(() => null)
  );
  const [statuses, setStatuses] = useState<ChangeStatus[]>(() =>
    proposal.changes.map(() => "pending")
  );
  const [applying, setApplying] = useState(false);

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

  /** Unassigned (not-in-any-deck) copies in the active collection, by card name. */
  const unassignedByName = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const copy of collectionData?.collection.cards ?? []) {
      if (copy.deckId) continue;
      const key = copy.card.name.toLowerCase();
      map.set(key, [...(map.get(key) ?? []), copy._id]);
    }
    return map;
  }, [collectionData]);

  const collectionReady = !activeCollection || collectionData !== undefined;
  const availability = (change: Change) =>
    activeCollection ? (unassignedByName.get(change.cardName.toLowerCase()) ?? []).length : 0;

  /** The mode an add row is effectively in: explicit choice, else a default. */
  const effectiveMode = (index: number): AddMode => {
    const explicit = addModes[index];
    if (explicit) return explicit;
    const change = proposal.changes[index];
    return availability(change) >= change.count ? "collection" : "ephemeral";
  };

  const done = statuses.every((s) => s !== "pending" && s !== "applying");
  // Apply stays available while anything is undecided — applying with every
  // row skipped/unchecked simply resolves the proposal without changes.
  const anyPending = statuses.some((s) => s === "pending");

  const setStatus = (index: number, status: ChangeStatus) =>
    setStatuses((prev) => prev.map((s, i) => (i === index ? status : s)));

  const applyAdd = async (change: Change, mode: AddMode, usedIds: Set<string>) => {
    if (mode === "ephemeral") {
      await createPhysicalCard.mutateAsync({
        cardId: change.cardId,
        deckId: proposal.deckId,
        sectionId: change.sectionId,
        quantity: change.count
      });
      return;
    }

    // mode === "collection": place real unassigned copies — no new documents.
    const candidates = (unassignedByName.get(change.cardName.toLowerCase()) ?? []).filter(
      (id) => !usedIds.has(id)
    );
    if (candidates.length === 0) {
      throw new Error(
        `No unassigned copies of ${change.cardName} in ${activeCollection?.name ?? "your active collection"}.`
      );
    }
    const take = candidates.slice(0, change.count);
    for (const physicalCardId of take) {
      usedIds.add(physicalCardId);
      await deckCardOp.mutateAsync({
        deckId: proposal.deckId,
        op: "place",
        physicalCardId,
        sectionId: change.sectionId
      });
    }
    if (take.length < change.count) {
      toast.info(
        `Placed ${take.length} of ${change.count} copies of ${change.cardName} — no more unassigned copies available.`
      );
    }
  };

  const applyRemoveOrMove = async (change: Change) => {
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
      throw new Error(
        `Only ${candidates.length} matching cop${candidates.length === 1 ? "y" : "ies"} of ${change.cardName} in the deck — it may have changed since the proposal.`
      );
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
    // Copies placed by one change are off-limits to the next (two adds of the
    // same card must not grab the same physical copy).
    const usedIds = new Set<string>();
    let applied = 0;
    let failed = 0;
    for (const [index, change] of proposal.changes.entries()) {
      if (statuses[index] !== "pending") continue;
      const mode = change.action === "add" ? effectiveMode(index) : null;
      if (mode) {
        // Freeze the chosen mode: applied rows must keep displaying what was
        // actually done (availability changes after apply would otherwise flip
        // an implicit default's highlight).
        setAddModes((prev) => prev.map((m, i) => (i === index ? mode : m)));
      }
      const isSkipped = change.action === "add" ? mode === "skip" : !selected[index];
      if (isSkipped) {
        setStatus(index, "skipped");
        continue;
      }
      setStatus(index, "applying");
      try {
        if (change.action === "add") await applyAdd(change, mode!, usedIds);
        else await applyRemoveOrMove(change);
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

      <div className="space-y-2">
        {proposal.changes.map((change, index) =>
          change.action === "add" ? (
            <div key={index} className="space-y-1" data-testid="proposal-change">
              <div className="flex items-center gap-2">
                <ActionIcon action={change.action} />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    (statuses[index] === "applied" || statuses[index] === "skipped") &&
                      "text-muted-foreground",
                    statuses[index] === "skipped" && "line-through"
                  )}
                >
                  {changeLabel(change)}
                </span>
                <StatusIcon status={statuses[index]} />
              </div>
              <AddModePicker
                mode={effectiveMode(index)}
                available={availability(change)}
                collectionName={activeCollection?.name}
                disabled={applying || statuses[index] !== "pending" || !collectionReady}
                onChange={(mode) =>
                  setAddModes((prev) => prev.map((m, i) => (i === index ? mode : m)))
                }
              />
            </div>
          ) : (
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
                  (statuses[index] === "applied" || statuses[index] === "skipped") &&
                    "text-muted-foreground",
                  statuses[index] !== "pending" && statuses[index] !== "failed" && "line-through"
                )}
              >
                {changeLabel(change)}
              </span>
              <StatusIcon status={statuses[index]} />
            </label>
          )
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {done
            ? "Done — ask for a new proposal to make further changes."
            : "Nothing is changed until you apply."}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={handleApply}
          disabled={applying || done || !anyPending || !deckData || !collectionReady}
        >
          {applying && <Loader2 className="animate-spin" />}
          Apply
        </Button>
      </div>
    </div>
  );
}

/**
 * Segmented three-way choice for one added card: place real unassigned copies
 * from the active collection, create placeholder copies, or skip.
 */
function AddModePicker({
  mode,
  available,
  collectionName,
  disabled,
  onChange
}: {
  mode: AddMode;
  available: number;
  collectionName?: string;
  disabled: boolean;
  onChange: (mode: AddMode) => void;
}) {
  const collectionDisabled = disabled || available === 0;
  const options: { value: AddMode; label: string; disabled: boolean; title?: string }[] = [
    {
      value: "collection",
      label: `My copies (${available})`,
      disabled: collectionDisabled,
      title: collectionName
        ? `Place unassigned copies from ${collectionName} — no new copies are created`
        : "Set an active collection to place real copies"
    },
    { value: "ephemeral", label: "Placeholder", disabled, title: "Create deck-only placeholder copies" },
    { value: "skip", label: "Skip", disabled, title: "Don't add this card" }
  ];

  return (
    <div className="ml-5 flex w-fit overflow-hidden rounded-md border" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={option.disabled}
          title={option.title}
          aria-pressed={mode === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "cursor-pointer border-r px-2 py-0.5 text-[11px] last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50",
            mode === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

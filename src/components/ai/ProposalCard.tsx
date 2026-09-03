"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import { normalizeCardName } from "@/lib/cardNames";
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

export interface ProposalCardProps {
  proposal: DeckChangeProposal;
  /**
   * Called exactly once, when every change has been decided (individually or
   * via Done). Receives a text summary of what was actually applied — the
   * panel sends it back to the model so it knows the real outcome.
   */
  onResolve?: (summary: string) => void;
  /** When the proposal was already resolved earlier (remount), its summary. */
  resolvedSummary?: string;
}

type Change = DeckChangeProposal["changes"][number];
type ChangeStatus = "pending" | "applying" | "applied" | "failed" | "skipped";

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
 * Renders a validated deck-change proposal from the AI. Every change is decided
 * INDIVIDUALLY, and deciding acts immediately:
 * - added cards offer "My copies (N)" (place N real unassigned copies from the
 *   active collection — no new copies are created), "Placeholder" (create
 *   ephemeral native-language copies), or "Skip";
 * - removes/moves offer "Apply" or "Skip";
 * - "Done" skips everything still undecided.
 *
 * Once every row is decided, {@link ProposalCardProps.onResolve} fires with a
 * summary of what actually happened, which the chat panel reports back to the
 * model. Applying reuses the app's normal mutation hooks — the AI itself never
 * writes anything.
 */
export default function ProposalCard({ proposal, onResolve, resolvedSummary }: ProposalCardProps) {
  const { activeCollection } = useOpenEntitiesContext();

  const [statuses, setStatuses] = useState<ChangeStatus[]>(() =>
    proposal.changes.map(() => "pending")
  );
  /** Human-readable outcome per decided row (feeds the summary). */
  const [outcomes, setOutcomes] = useState<(string | null)[]>(() =>
    proposal.changes.map(() => null)
  );
  const [busy, setBusy] = useState(false);
  /** Physical ids already consumed by a decided change (never reused). */
  const [usedIds, setUsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const resolvedRef = useRef(false);

  // A summary present at MOUNT means this proposal was resolved in an earlier
  // mount — render the compact locked card. A card the user finishes here
  // keeps its detailed per-row outcome view (the prop arrives post-mount).
  const [alreadyResolved] = useState(() => resolvedSummary !== undefined);

  const { data: deckData } = useRetrieveDeckDetails(alreadyResolved ? null : proposal.deckId);
  const { data: collectionData } = useRetrieveCollectionDetails(
    alreadyResolved ? null : (activeCollection?._id ?? null)
  );
  const createPhysicalCard = useCreatePhysicalCard();
  const deckCardOp = useDeckCardOp();

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

  /** Unassigned (not-in-any-deck) copies in the active collection, by name key. */
  const unassignedByName = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const copy of collectionData?.collection.cards ?? []) {
      if (copy.deckId) continue;
      const key = normalizeCardName(copy.card.name);
      map.set(key, [...(map.get(key) ?? []), copy._id]);
    }
    return map;
  }, [collectionData]);

  const ready = deckData !== undefined && (!activeCollection || collectionData !== undefined);
  const availability = (change: Change) =>
    activeCollection
      ? (unassignedByName.get(normalizeCardName(change.cardName)) ?? []).filter(
          (id) => !usedIds.has(id)
        ).length
      : 0;

  const setRow = (index: number, status: ChangeStatus, outcome: string | null) => {
    setStatuses((prev) => prev.map((s, i) => (i === index ? status : s)));
    setOutcomes((prev) => prev.map((o, i) => (i === index ? outcome : o)));
  };

  // Resolve exactly once, when every row is decided.
  const allDecided = statuses.every((s) => s !== "pending" && s !== "applying");
  useEffect(() => {
    if (alreadyResolved || !allDecided || resolvedRef.current) return;
    resolvedRef.current = true;
    const summary =
      `[Proposal outcome for "${proposal.deckName}"] ` +
      outcomes.filter((o): o is string => o !== null).join("; ");
    onResolve?.(summary);
  }, [alreadyResolved, allDecided, outcomes, onResolve, proposal.deckName]);

  const applyAdd = async (index: number, change: Change, mode: "collection" | "ephemeral") => {
    setBusy(true);
    setRow(index, "applying", null);
    try {
      if (mode === "ephemeral") {
        await createPhysicalCard.mutateAsync({
          cardId: change.cardId,
          deckId: proposal.deckId,
          sectionId: change.sectionId,
          quantity: change.count
        });
        setRow(index, "applied", `added ${change.count}x ${change.cardName} (placeholders)`);
        return;
      }

      // Place real unassigned copies — no new documents.
      const candidates = (
        unassignedByName.get(normalizeCardName(change.cardName)) ?? []
      ).filter((id) => !usedIds.has(id));
      if (candidates.length === 0) {
        throw new Error(
          `No unassigned copies of ${change.cardName} in ${activeCollection?.name ?? "your active collection"}.`
        );
      }
      const take = candidates.slice(0, change.count);
      setUsedIds((prev) => new Set([...prev, ...take]));
      for (const physicalCardId of take) {
        await deckCardOp.mutateAsync({
          deckId: proposal.deckId,
          op: "place",
          physicalCardId,
          sectionId: change.sectionId
        });
      }
      setRow(index, "applied", `added ${take.length}x ${change.cardName} (real copies from ${activeCollection?.name ?? "collection"})`);
      if (take.length < change.count) {
        toast.info(`Placed ${take.length} of ${change.count} copies of ${change.cardName}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred.";
      setRow(index, "failed", `FAILED to add ${change.cardName} (${message})`);
      toast.error(`${changeLabel(change)} failed`, { description: message });
    } finally {
      setBusy(false);
    }
  };

  const applyRemoveOrMove = async (index: number, change: Change) => {
    setBusy(true);
    setRow(index, "applying", null);
    try {
      const nameKey = normalizeCardName(change.cardName);
      const candidates = deckEntries.filter((entry) => {
        if (usedIds.has(entry._id)) return false;
        if (normalizeCardName(entry.name) !== nameKey) return false;
        if (change.action === "remove") {
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
      const taken = candidates.slice(0, change.count);
      setUsedIds((prev) => new Set([...prev, ...taken.map((e) => e._id)]));
      for (const entry of taken) {
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
      setRow(
        index,
        "applied",
        change.action === "remove"
          ? `removed ${change.count}x ${change.cardName}`
          : `moved ${change.count}x ${change.cardName} to ${change.sectionName}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred.";
      setRow(index, "failed", `FAILED to ${change.action} ${change.cardName} (${message})`);
      toast.error(`${changeLabel(change)} failed`, { description: message });
    } finally {
      setBusy(false);
    }
  };

  const skipRow = (index: number, change: Change) =>
    setRow(index, "skipped", `skipped: ${changeLabel(change).toLowerCase()}`);

  const handleDone = () => {
    proposal.changes.forEach((change, index) => {
      if (statuses[index] === "pending") skipRow(index, change);
    });
  };

  if (alreadyResolved) {
    return (
      <div className="bg-muted/30 rounded-md border p-3 text-sm" data-testid="proposal-card">
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <ClipboardList className="size-4 shrink-0" />
          Proposed changes to {proposal.deckName}
        </div>
        <p className="text-muted-foreground text-xs">Resolved — see the outcome message below.</p>
      </div>
    );
  }

  return (
    <div className="bg-muted/30 rounded-md border p-3 text-sm" data-testid="proposal-card">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold">
        <ClipboardList className="size-4 shrink-0" />
        Proposed changes to {proposal.deckName}
      </div>
      <p className="text-muted-foreground mb-2 text-xs">{proposal.rationale}</p>

      <div className="space-y-2">
        {proposal.changes.map((change, index) => {
          const status = statuses[index];
          const decided = status !== "pending";
          const disabled = busy || decided || !ready;
          return (
            <div key={index} className="space-y-1" data-testid="proposal-change">
              <div className="flex items-center gap-2">
                <ActionIcon action={change.action} />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    decided && status !== "failed" && "text-muted-foreground",
                    status === "skipped" && "line-through"
                  )}
                >
                  {changeLabel(change)}
                </span>
                <StatusIcon status={status} />
              </div>
              {!decided && (
                <div className="ml-5 flex w-fit overflow-hidden rounded-md border" role="group">
                  {change.action === "add" ? (
                    <>
                      <RowButton
                        label={`My copies (${availability(change)})`}
                        title={
                          activeCollection
                            ? `Place unassigned copies from ${activeCollection.name} — no new copies are created`
                            : "Set an active collection to place real copies"
                        }
                        disabled={disabled || availability(change) === 0}
                        onClick={() => applyAdd(index, change, "collection")}
                      />
                      <RowButton
                        label="Placeholder"
                        title="Create deck-only placeholder copies"
                        disabled={disabled}
                        onClick={() => applyAdd(index, change, "ephemeral")}
                      />
                    </>
                  ) : (
                    <RowButton
                      label="Apply"
                      disabled={disabled}
                      onClick={() => applyRemoveOrMove(index, change)}
                    />
                  )}
                  <RowButton
                    label="Skip"
                    title={change.action === "add" ? "Don't add this card" : "Leave it as is"}
                    disabled={disabled}
                    onClick={() => skipRow(index, change)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {allDecided
            ? "Resolved — the advisor is told what was actually applied."
            : "Decide each card — the advisor waits for the outcome."}
        </p>
        {!allDecided && (
          <Button type="button" size="sm" variant="outline" onClick={handleDone} disabled={busy}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}

/** One immediate-action button in a row's segmented control. */
function RowButton({
  label,
  title,
  disabled,
  onClick
}: {
  label: string;
  title?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground hover:bg-muted cursor-pointer border-r px-2 py-0.5 text-[11px] last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

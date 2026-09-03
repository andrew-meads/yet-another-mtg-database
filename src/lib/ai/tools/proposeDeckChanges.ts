import { tool } from "ai";
import { z } from "zod";
import { DeckModel, PhysicalCardModel, CardData } from "@/db/schema";
import { ToolContext, findNativePrintingByName, isValidObjectId, safeExecute } from "./shared";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The propose-and-confirm write path: this tool's INPUT is the proposal. It
 * validates ids/ownership/feasibility and echoes a normalized proposal back as
 * its result — it writes NOTHING. The chat panel renders the echoed proposal
 * as a card where the user decides, per added card, whether to place real
 * copies from their active collection, create ephemeral placeholders (of the
 * system's native-language printing, resolved here), or skip it; Apply calls
 * the existing mutation hooks, so ownership checks, ephemeral semantics, and
 * cache invalidation all reuse the app's normal write path.
 */

const changeSchema = z.object({
  action: z
    .enum(["add", "remove", "move"])
    .describe(
      '"add" a copy to the deck (the user chooses whether it comes from their collection, is created as a placeholder, or is skipped), "remove" a copy from the deck (a collection-backed copy returns to its collection; an ephemeral placeholder is deleted), or "move" a copy between deck sections'
    ),
  cardName: z.string().min(1).describe("Exact card name"),
  count: z.number().int().min(1).max(8).optional().describe("How many copies (default 1)"),
  sectionName: z
    .string()
    .optional()
    .describe(
      "Deck section: the target section for add/move (move REQUIRES it; add defaults to the first section), or the section to remove from (optional filter)"
    )
});

const inputSchema = z.object({
  deckId: z.string().describe("The id of the deck to propose changes to"),
  changes: z.array(changeSchema).min(1).max(20),
  rationale: z
    .string()
    .min(1)
    .max(1000)
    .describe("One short paragraph explaining the proposal as a whole")
});

export type ProposedChange = z.infer<typeof changeSchema> & {
  cardId: string;
  count: number;
  sectionId?: string;
};

/** Count copies of each card name (lowercased) currently in the deck. */
function countByName(cardNames: Map<string, string>, physical: { cardId: string }[]) {
  const counts = new Map<string, number>();
  for (const pc of physical) {
    const name = cardNames.get(pc.cardId);
    if (!name) continue;
    const key = name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function makeProposeDeckChangesTool({ userId }: ToolContext) {
  return tool({
    description:
      "Propose a set of deck changes for the user to review and apply. Call this whenever the user asks you to change, fix, or build on a deck — after you have settled on concrete changes. The proposal is validated and shown to the user as a checklist with an Apply button; NOTHING is changed until the user applies it. Never claim a change has been made — the user decides.",
    inputSchema,
    execute: safeExecute(
      "proposeDeckChanges",
      async ({ deckId, changes, rationale }: z.infer<typeof inputSchema>) => {
        if (!isValidObjectId(deckId)) return { error: "Invalid deck id" };

        const deck = await DeckModel.findOne({ _id: deckId, owner: userId }).lean();
        if (!deck) return { error: "Deck not found" };

        const sectionsByName = new Map<string, { _id: string; name: string }>(
          (deck.sections as any[]).map((s) => [s.name.toLowerCase(), { _id: String(s._id), name: s.name }])
        );

        // What the deck currently holds, by card name.
        const physical = await PhysicalCardModel.find({ deckId, owner: userId }, { cardId: 1 }).lean();
        const deckCards = await CardData.find(
          { id: { $in: [...new Set(physical.map((pc) => pc.cardId))] } },
          { _id: 0, id: 1, name: 1 }
        ).lean();
        const nameById = new Map(deckCards.map((c: any) => [c.id as string, c.name as string]));
        const copiesByName = countByName(nameById, physical);

        const invalid: { index: number; reason: string }[] = [];
        const normalized: ProposedChange[] = [];

        for (const [index, change] of changes.entries()) {
          const count = change.count ?? 1;
          const nameKey = change.cardName.trim().toLowerCase();

          // Resolve the section (when named).
          let section: { _id: string; name: string } | undefined;
          if (change.sectionName) {
            section = sectionsByName.get(change.sectionName.trim().toLowerCase());
            if (!section) {
              invalid.push({
                index,
                reason: `No section named "${change.sectionName}". Sections: ${(deck.sections as any[]).map((s) => s.name).join(", ")}`
              });
              continue;
            }
          } else if (change.action === "move") {
            invalid.push({ index, reason: "move requires a sectionName (the destination)" });
            continue;
          }

          if (change.action === "add") {
            // Resolve to the newest native-language printing: if the user opts
            // for placeholder copies, this is the printing they get.
            const card = await findNativePrintingByName(change.cardName);
            if (!card) {
              invalid.push({ index, reason: `Unknown card "${change.cardName}"` });
              continue;
            }
            normalized.push({
              action: "add",
              cardName: card.name,
              cardId: card.id,
              count,
              sectionName: section?.name,
              sectionId: section?._id
            });
            continue;
          }

          // remove / move operate on copies already in the deck.
          const present = copiesByName.get(nameKey) ?? 0;
          if (present === 0) {
            invalid.push({
              index,
              reason: `The deck contains no copies of "${change.cardName}"`
            });
            continue;
          }
          if (present < count) {
            invalid.push({
              index,
              reason: `The deck has only ${present} cop${present === 1 ? "y" : "ies"} of "${change.cardName}" (asked for ${count})`
            });
            continue;
          }
          // Canonical casing from the deck's own card data.
          const canonical =
            [...nameById.values()].find((n) => n.toLowerCase() === nameKey) ?? change.cardName;
          const cardId =
            [...nameById.entries()].find(([, n]) => n.toLowerCase() === nameKey)?.[0] ?? "";
          normalized.push({
            action: change.action,
            cardName: canonical,
            cardId,
            count,
            sectionName: section?.name,
            sectionId: section?._id
          });
        }

        if (invalid.length > 0) {
          return {
            error: "Proposal rejected — fix the invalid changes and propose again.",
            invalid
          };
        }

        return {
          proposal: {
            deckId,
            deckName: deck.name,
            rationale,
            changes: normalized
          }
        };
      }
    )
  });
}

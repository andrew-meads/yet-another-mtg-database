import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProposalCard, { DeckChangeProposal } from "@/components/ai/ProposalCard";

const h = {
  activeCollection: { _id: "coll-1", name: "Main Collection" } as { _id: string; name: string } | null
};

vi.mock("@/context/OpenEntitiesContext", () => ({
  useOpenEntitiesContext: () => ({ activeCollection: h.activeCollection })
}));

const DECK_ID = "deck-1";

/** Wire-shaped deck details: Main holds 2x Bolt + 1x Forest, Sideboard empty. */
const deckDetailsResponse = {
  deck: {
    _id: DECK_ID,
    name: "Prop Deck",
    description: "",
    isActive: false,
    owner: "u1",
    kind: "deck",
    sections: [
      {
        _id: "sec-main",
        name: "Main",
        columns: [
          {
            _id: "col-1",
            cards: [
              { _id: "p-bolt-1", cardId: "c-bolt", collectionId: "coll-1", deckId: DECK_ID },
              { _id: "p-bolt-2", cardId: "c-bolt", collectionId: "coll-1", deckId: DECK_ID },
              { _id: "p-forest-1", cardId: "c-forest", collectionId: "coll-1", deckId: DECK_ID }
            ]
          }
        ]
      },
      { _id: "sec-side", name: "Sideboard", columns: [{ _id: "col-2", cards: [] }] }
    ]
  },
  cardData: {
    "c-bolt": { id: "c-bolt", name: "Lightning Bolt" },
    "c-forest": { id: "c-forest", name: "Forest" }
  }
};

/**
 * Wire-shaped active collection: 2 unassigned Shocks + 1 Shock already in
 * another deck, plus the deck-assigned Bolts (no unassigned Bolt copies).
 */
const collectionDetailsResponse = {
  collection: {
    _id: "coll-1",
    name: "Main Collection",
    description: "",
    isActive: true,
    owner: "u1",
    kind: "collection",
    cards: [
      { _id: "p-shock-1", cardId: "c-shock", collectionId: "coll-1", deckId: null },
      { _id: "p-shock-2", cardId: "c-shock", collectionId: "coll-1", deckId: null },
      { _id: "p-shock-3", cardId: "c-shock", collectionId: "coll-1", deckId: "other-deck" },
      { _id: "p-bolt-1", cardId: "c-bolt", collectionId: "coll-1", deckId: DECK_ID },
      { _id: "p-bolt-2", cardId: "c-bolt", collectionId: "coll-1", deckId: DECK_ID }
    ]
  },
  cardData: {
    "c-shock": { id: "c-shock", name: "Shock" },
    "c-bolt": { id: "c-bolt", name: "Lightning Bolt" }
  }
};

let fetchMock: ReturnType<typeof vi.spyOn>;
/** Bodies of POSTs, in order. */
let posts: { url: string; body: Record<string, unknown> }[];
let collectionFetches: number;

beforeEach(() => {
  h.activeCollection = { _id: "coll-1", name: "Main Collection" };
  posts = [];
  collectionFetches = 0;
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes(`/api/decks/${DECK_ID}?details=true`)) {
      return Response.json(deckDetailsResponse);
    }
    if (url.includes("/api/collections/coll-1")) {
      collectionFetches += 1;
      return Response.json(collectionDetailsResponse);
    }
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(init.body as string) });
      return Response.json({ ok: true, physicalCardIds: ["new-1"] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as never;
});

afterEach(() => fetchMock.mockRestore());

function makeProposal(changes: DeckChangeProposal["changes"]): DeckChangeProposal {
  return { deckId: DECK_ID, deckName: "Prop Deck", rationale: "Test rationale.", changes };
}

const addShock = (count: number): DeckChangeProposal["changes"][number] => ({
  action: "add",
  cardName: "Shock",
  cardId: "c-shock",
  count,
  sectionName: "Main",
  sectionId: "sec-main"
});

function renderCard(proposal: DeckChangeProposal) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ProposalCard proposal={proposal} />
    </QueryClientProvider>
  );
  return { invalidate };
}

async function clickApplyWhenReady() {
  // Apply is disabled until the deck (and active collection) details load.
  const button = screen.getByRole("button", { name: /Apply/ });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

describe("ProposalCard", () => {
  it("renders the rationale, rows, and a per-add mode picker with availability", async () => {
    renderCard(
      makeProposal([
        addShock(2),
        { action: "remove", cardName: "Lightning Bolt", cardId: "c-bolt", count: 1 }
      ])
    );

    expect(screen.getByText("Test rationale.")).toBeInTheDocument();
    const rows = screen.getAllByTestId("proposal-change");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Add 2x Shock to Main");
    expect(rows[1]).toHaveTextContent("Remove 1x Lightning Bolt");

    // 2 unassigned Shocks in the active collection (the third is deck-assigned).
    expect(await screen.findByRole("button", { name: "My copies (2)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Placeholder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("defaults to placing real copies and applies them via op:place — creating nothing", async () => {
    const { invalidate } = renderCard(makeProposal([addShock(2)]));

    const myCopies = await screen.findByRole("button", { name: "My copies (2)" });
    await waitFor(() => expect(myCopies).toHaveAttribute("aria-pressed", "true"));
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(2));
    // Both POSTs are deck placements of the EXISTING unassigned copies.
    expect(posts.every((p) => p.url === `/api/decks/${DECK_ID}/cards`)).toBe(true);
    expect(posts.map((p) => p.body)).toEqual([
      { op: "place", physicalCardId: "p-shock-1", sectionId: "sec-main" },
      { op: "place", physicalCardId: "p-shock-2", sectionId: "sec-main" }
    ]);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deck-details"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["collection-details"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["card-locations"] });
  });

  it("creates ephemeral placeholder copies when that mode is chosen", async () => {
    renderCard(makeProposal([addShock(2)]));

    const placeholder = await screen.findByRole("button", { name: "Placeholder" });
    await waitFor(() => expect(placeholder).toBeEnabled());
    fireEvent.click(placeholder);
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/api/physical-cards");
    // No collectionId — an ephemeral, deck-only copy of the resolved printing.
    expect(posts[0].body).toEqual({
      cardId: "c-shock",
      deckId: DECK_ID,
      sectionId: "sec-main",
      quantity: 2
    });
  });

  it("skips an added card entirely when Skip is chosen", async () => {
    renderCard(makeProposal([addShock(1)]));

    const skip = await screen.findByRole("button", { name: "Skip" });
    await waitFor(() => expect(skip).toBeEnabled());
    fireEvent.click(skip);
    await clickApplyWhenReady();

    await waitFor(() => expect(screen.getByText(/Done —/)).toBeInTheDocument());
    expect(posts).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Apply/ })).toBeDisabled();
  });

  it("disables the real-copies option (and defaults to placeholders) when none are unassigned", async () => {
    // Both Bolt copies in the collection are already deck-assigned.
    renderCard(
      makeProposal([
        { action: "add", cardName: "Lightning Bolt", cardId: "c-bolt", count: 1, sectionName: "Main", sectionId: "sec-main" }
      ])
    );

    const myCopies = await screen.findByRole("button", { name: "My copies (0)" });
    await waitFor(() => expect(myCopies).toBeDisabled());
    expect(screen.getByRole("button", { name: "Placeholder" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("defaults to placeholders when fewer copies are available than proposed, but places what exists if chosen", async () => {
    renderCard(makeProposal([addShock(3)]));

    const myCopies = await screen.findByRole("button", { name: "My copies (2)" });
    // Only 2 of 3 available -> placeholder is the default…
    expect(screen.getByRole("button", { name: "Placeholder" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // …but the user can still choose the real copies.
    fireEvent.click(myCopies);
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.every((p) => p.body.op === "place")).toBe(true);
  });

  it("works without an active collection: real-copies disabled, placeholders apply", async () => {
    h.activeCollection = null;
    renderCard(makeProposal([addShock(1)]));

    const myCopies = await screen.findByRole("button", { name: "My copies (0)" });
    expect(myCopies).toBeDisabled();
    expect(screen.getByRole("button", { name: "Placeholder" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ cardId: "c-shock", deckId: DECK_ID, sectionId: "sec-main", quantity: 1 });
    expect(collectionFetches).toBe(0);
  });

  it("never hands the same physical copy to two changes", async () => {
    renderCard(makeProposal([addShock(1), addShock(1)]));

    const pickers = await screen.findAllByRole("button", { name: "My copies (2)" });
    await waitFor(() => expect(pickers[0]).toHaveAttribute("aria-pressed", "true"));
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => p.body.physicalCardId).sort()).toEqual(["p-shock-1", "p-shock-2"]);
  });

  it("applies removes by resolving physical copies from the deck details", async () => {
    renderCard(
      makeProposal([{ action: "remove", cardName: "Lightning Bolt", cardId: "c-bolt", count: 2 }])
    );
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => p.body.physicalCardId).sort()).toEqual(["p-bolt-1", "p-bolt-2"]);
    expect(posts.every((p) => p.body.op === "remove")).toBe(true);
  });

  it("applies moves to the target section, skipping copies already there", async () => {
    renderCard(
      makeProposal([
        { action: "move", cardName: "Forest", cardId: "c-forest", count: 1, sectionName: "Sideboard", sectionId: "sec-side" }
      ])
    );
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject({
      op: "move",
      physicalCardId: "p-forest-1",
      sectionId: "sec-side"
    });
  });

  it("marks unchecked remove/move rows as skipped", async () => {
    renderCard(
      makeProposal([
        { action: "remove", cardName: "Lightning Bolt", cardId: "c-bolt", count: 1 },
        { action: "remove", cardName: "Forest", cardId: "c-forest", count: 1 }
      ])
    );
    const checkbox = await screen.findByLabelText("Remove 1x Lightning Bolt");
    fireEvent.click(checkbox);
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body.physicalCardId).toBe("p-forest-1");
    expect(screen.getByText(/Done —/)).toBeInTheDocument();
  });

  it("disables Apply after all selected changes are applied", async () => {
    renderCard(
      makeProposal([{ action: "remove", cardName: "Forest", cardId: "c-forest", count: 1 }])
    );
    await clickApplyWhenReady();

    await waitFor(() => expect(screen.getByRole("button", { name: /Apply/ })).toBeDisabled());
    expect(screen.getByText(/Done —/)).toBeInTheDocument();
  });
});

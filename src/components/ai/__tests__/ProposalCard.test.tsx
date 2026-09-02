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

let fetchMock: ReturnType<typeof vi.spyOn>;
/** Bodies of POSTs, keyed by endpoint. */
let posts: { url: string; body: any }[];

beforeEach(() => {
  h.activeCollection = { _id: "coll-1", name: "Main Collection" };
  posts = [];
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes(`/api/decks/${DECK_ID}?details=true`)) {
      return Response.json(deckDetailsResponse);
    }
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(init.body as string) });
      return Response.json({ ok: true, physicalCardIds: ["new-1"] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;
});

afterEach(() => fetchMock.mockRestore());

function makeProposal(changes: DeckChangeProposal["changes"]): DeckChangeProposal {
  return { deckId: DECK_ID, deckName: "Prop Deck", rationale: "Test rationale.", changes };
}

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
  // Apply is disabled until the deck details load.
  const button = screen.getByRole("button", { name: /Apply/ });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

describe("ProposalCard", () => {
  it("renders the rationale and one labeled row per change", async () => {
    renderCard(
      makeProposal([
        { action: "add", cardName: "Shock", cardId: "c-shock", count: 2, sectionName: "Main", sectionId: "sec-main" },
        { action: "remove", cardName: "Lightning Bolt", cardId: "c-bolt", count: 1 },
        { action: "move", cardName: "Forest", cardId: "c-forest", count: 1, sectionName: "Sideboard", sectionId: "sec-side" }
      ])
    );

    expect(screen.getByText("Test rationale.")).toBeInTheDocument();
    const rows = screen.getAllByTestId("proposal-change");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Add 2x Shock to Main");
    expect(rows[1]).toHaveTextContent("Remove 1x Lightning Bolt");
    expect(rows[2]).toHaveTextContent("Move 1x Forest to Sideboard");
  });

  it("applies an add via POST /api/physical-cards with the active collection, then invalidates membership", async () => {
    const { invalidate } = renderCard(
      makeProposal([
        { action: "add", cardName: "Shock", cardId: "c-shock", count: 2, sectionName: "Main", sectionId: "sec-main" }
      ])
    );
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/api/physical-cards");
    expect(posts[0].body).toEqual({
      cardId: "c-shock",
      collectionId: "coll-1",
      deckId: DECK_ID,
      sectionId: "sec-main",
      quantity: 2
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deck-details"] })
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["collection-details"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["card-locations"] });
  });

  it("creates ephemeral adds without a collection (and without needing one)", async () => {
    h.activeCollection = null;
    renderCard(
      makeProposal([
        { action: "add", cardName: "Shock", cardId: "c-shock", count: 1, ephemeral: true }
      ])
    );
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ cardId: "c-shock", deckId: DECK_ID, quantity: 1 });
  });

  it("fails a non-ephemeral add when no collection is active, without posting", async () => {
    h.activeCollection = null;
    renderCard(
      makeProposal([{ action: "add", cardName: "Shock", cardId: "c-shock", count: 1 }])
    );
    await clickApplyWhenReady();

    await waitFor(() =>
      expect(screen.getByText(/Done —/)).toBeInTheDocument()
    );
    expect(posts).toHaveLength(0);
  });

  it("applies removes by resolving physical copies from the deck details", async () => {
    renderCard(
      makeProposal([{ action: "remove", cardName: "Lightning Bolt", cardId: "c-bolt", count: 2 }])
    );
    await clickApplyWhenReady();

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => p.url)).toEqual([
      `/api/decks/${DECK_ID}/cards`,
      `/api/decks/${DECK_ID}/cards`
    ]);
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

  it("skips unchecked changes", async () => {
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
  });

  it("disables Apply after all selected changes are applied", async () => {
    renderCard(
      makeProposal([{ action: "remove", cardName: "Forest", cardId: "c-forest", count: 1 }])
    );
    await clickApplyWhenReady();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Apply/ })).toBeDisabled()
    );
    expect(screen.getByText(/Done —/)).toBeInTheDocument();
  });
});

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

/** Wire-shaped active collection: 2 unassigned Shocks, 1 Shock in another deck. */
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
      { _id: "p-shock-3", cardId: "c-shock", collectionId: "coll-1", deckId: "other-deck" }
    ]
  },
  cardData: { "c-shock": { id: "c-shock", name: "Shock" } }
};

let fetchMock: ReturnType<typeof vi.spyOn>;
/** Bodies of POSTs, in order. */
let posts: { url: string; body: Record<string, unknown> }[];

beforeEach(() => {
  h.activeCollection = { _id: "coll-1", name: "Main Collection" };
  posts = [];
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes(`/api/decks/${DECK_ID}?details=true`)) {
      return Response.json(deckDetailsResponse);
    }
    if (url.includes("/api/collections/coll-1")) {
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

const removeBolt = (count: number): DeckChangeProposal["changes"][number] => ({
  action: "remove",
  cardName: "Lightning Bolt",
  cardId: "c-bolt",
  count
});

function renderCard(proposal: DeckChangeProposal, resolvedSummary?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const onResolve = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ProposalCard proposal={proposal} onResolve={onResolve} resolvedSummary={resolvedSummary} />
    </QueryClientProvider>
  );
  return { onResolve };
}

/** Row buttons are disabled until the deck + collection details load. */
async function findEnabledButton(name: string | RegExp) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe("ProposalCard", () => {
  it("places real copies immediately when 'My copies' is clicked and reports the outcome", async () => {
    const { onResolve } = renderCard(makeProposal([addShock(2)]));

    fireEvent.click(await findEnabledButton("My copies (2)"));

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.every((p) => p.url === `/api/decks/${DECK_ID}/cards`)).toBe(true);
    expect(posts.map((p) => p.body)).toEqual([
      { op: "place", physicalCardId: "p-shock-1", sectionId: "sec-main" },
      { op: "place", physicalCardId: "p-shock-2", sectionId: "sec-main" }
    ]);
    // Single-change proposal: deciding it resolves the card with a summary.
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
    expect(onResolve.mock.calls[0][0]).toBe(
      '[Proposal outcome for "Prop Deck"] added 2x Shock (real copies from Main Collection)'
    );
  });

  it("creates ephemeral copies when 'Placeholder' is clicked", async () => {
    const { onResolve } = renderCard(makeProposal([addShock(2)]));

    fireEvent.click(await findEnabledButton("Placeholder"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/api/physical-cards");
    expect(posts[0].body).toEqual({
      cardId: "c-shock",
      deckId: DECK_ID,
      sectionId: "sec-main",
      quantity: 2
    });
    await waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith(
        '[Proposal outcome for "Prop Deck"] added 2x Shock (placeholders)'
      )
    );
  });

  it("skips a card without touching the network", async () => {
    const { onResolve } = renderCard(makeProposal([addShock(1)]));

    fireEvent.click(await findEnabledButton("Skip"));

    await waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith(
        '[Proposal outcome for "Prop Deck"] skipped: add 1x shock to main'
      )
    );
    expect(posts).toHaveLength(0);
  });

  it("disables 'My copies' when no unassigned copies exist", async () => {
    // Bolt has no unassigned copies in the collection fixture.
    renderCard(
      makeProposal([
        { action: "add", cardName: "Lightning Bolt", cardId: "c-bolt", count: 1, sectionName: "Main", sectionId: "sec-main" }
      ])
    );

    await findEnabledButton("Placeholder");
    expect(screen.getByRole("button", { name: "My copies (0)" })).toBeDisabled();
  });

  it("applies removes per row via the deck's physical copies", async () => {
    const { onResolve } = renderCard(makeProposal([removeBolt(2)]));

    fireEvent.click(await findEnabledButton("Apply"));

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => p.body.physicalCardId).sort()).toEqual(["p-bolt-1", "p-bolt-2"]);
    expect(posts.every((p) => p.body.op === "remove")).toBe(true);
    await waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith(
        '[Proposal outcome for "Prop Deck"] removed 2x Lightning Bolt'
      )
    );
  });

  it("only resolves after EVERY row is decided, combining outcomes in order", async () => {
    const { onResolve } = renderCard(makeProposal([addShock(1), removeBolt(1)]));

    fireEvent.click(await findEnabledButton("Placeholder"));
    await waitFor(() => expect(posts).toHaveLength(1));
    // One row decided, one still pending: not resolved yet.
    expect(onResolve).not.toHaveBeenCalled();

    fireEvent.click(await findEnabledButton("Apply"));
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
    expect(onResolve.mock.calls[0][0]).toBe(
      '[Proposal outcome for "Prop Deck"] added 1x Shock (placeholders); removed 1x Lightning Bolt'
    );
  });

  it("Done auto-skips everything still undecided and resolves", async () => {
    const { onResolve } = renderCard(makeProposal([addShock(1), removeBolt(1)]));

    fireEvent.click(await findEnabledButton("Placeholder"));
    await waitFor(() => expect(posts).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
    expect(onResolve.mock.calls[0][0]).toBe(
      '[Proposal outcome for "Prop Deck"] added 1x Shock (placeholders); skipped: remove 1x lightning bolt'
    );
    // No further posts happened for the skipped remove.
    expect(posts).toHaveLength(1);
  });

  it("shows the waiting hint until resolved, then the resolved note", async () => {
    renderCard(makeProposal([addShock(1)]));
    expect(screen.getByText(/the advisor waits for the outcome/)).toBeInTheDocument();

    fireEvent.click(await findEnabledButton("Skip"));
    await waitFor(() =>
      expect(screen.getByText(/the advisor is told what was actually applied/)).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });

  it("renders a compact locked card when mounted with an existing resolution", async () => {
    const { onResolve } = renderCard(
      makeProposal([addShock(1)]),
      '[Proposal outcome for "Prop Deck"] skipped: add 1x shock to main'
    );

    expect(screen.getByText(/Resolved — see the outcome message below/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /My copies/ })).not.toBeInTheDocument();
    expect(onResolve).not.toHaveBeenCalled();
  });
});

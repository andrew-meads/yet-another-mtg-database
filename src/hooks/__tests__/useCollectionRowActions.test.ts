import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { CollectionGroupRow } from "@/components/my-cards-page/collection-view/grouping";

// Shared spies + mutable context state (hoisted so the mock factories can close over them).
const m = vi.hoisted(() => ({
  updateCard: vi.fn(),
  deckOp: vi.fn(),
  toastError: vi.fn(),
  state: {
    activeCollection: null as null | { _id: string },
    activeDeck: null as null | { _id: string }
  }
}));

vi.mock("sonner", () => ({ toast: { error: m.toastError } }));
vi.mock("@/context/OpenEntitiesContext", () => ({
  useOpenEntitiesContext: () => ({
    activeCollection: m.state.activeCollection,
    activeDeck: m.state.activeDeck
  })
}));
vi.mock("@/hooks/react-query/useUpdatePhysicalCard", () => ({
  useUpdatePhysicalCard: () => ({ mutate: m.updateCard })
}));
vi.mock("@/hooks/react-query/useDeckCardOp", () => ({
  useDeckCardOp: () => ({ mutate: m.deckOp })
}));

import { useCollectionRowActions } from "@/hooks/useCollectionRowActions";

function makeRow(over: Partial<CollectionGroupRow> = {}): CollectionGroupRow {
  return {
    key: "k1",
    card: { id: "card-1", name: "Lightning Bolt" } as never,
    deckId: null,
    physicalCardIds: ["p1", "p2", "p3"],
    quantity: 3,
    ...over
  };
}

function actions(collectionId = "this-coll") {
  return renderHook(() => useCollectionRowActions(collectionId)).result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.activeCollection = { _id: "active-coll" };
  m.state.activeDeck = { _id: "active-deck" };
});

describe("moveOneToCollection", () => {
  it("moves exactly one copy (the first id) to an explicit collection", () => {
    actions().moveOneToCollection(makeRow(), "other-coll");
    expect(m.updateCard).toHaveBeenCalledExactlyOnceWith({
      physicalCardId: "p1",
      collectionId: "other-coll"
    });
    expect(m.toastError).not.toHaveBeenCalled();
  });

  it("targets the active collection when no target is given", () => {
    actions().moveOneToCollection(makeRow());
    expect(m.updateCard).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "active-coll" })
    );
  });

  it("errors instead of moving when the active collection is this collection", () => {
    m.state.activeCollection = { _id: "this-coll" };
    actions().moveOneToCollection(makeRow());
    expect(m.toastError).toHaveBeenCalledWith("This is already the active collection.");
    expect(m.updateCard).not.toHaveBeenCalled();
  });

  it("errors when the explicit target is this collection", () => {
    actions().moveOneToCollection(makeRow(), "this-coll");
    expect(m.toastError).toHaveBeenCalledWith("These copies are already in this collection.");
    expect(m.updateCard).not.toHaveBeenCalled();
  });

  it("errors when there is no active collection and no explicit target", () => {
    m.state.activeCollection = null;
    actions().moveOneToCollection(makeRow());
    expect(m.toastError).toHaveBeenCalledWith("Set an active collection first.");
    expect(m.updateCard).not.toHaveBeenCalled();
  });

  it("works on deck-assigned rows (collection moves keep the deck)", () => {
    actions().moveOneToCollection(makeRow({ deckId: "d1", deckName: "Burn" }), "other-coll");
    expect(m.updateCard).toHaveBeenCalledExactlyOnceWith({
      physicalCardId: "p1",
      collectionId: "other-coll"
    });
  });
});

describe("addOneToDeck", () => {
  it("places exactly one copy (the first id) into the active deck", () => {
    actions().addOneToDeck(makeRow());
    expect(m.deckOp).toHaveBeenCalledExactlyOnceWith({
      deckId: "active-deck",
      op: "place",
      physicalCardId: "p1"
    });
    expect(m.toastError).not.toHaveBeenCalled();
  });

  it("omits section/column/index so the server appends to the first column", () => {
    actions().addOneToDeck(makeRow());
    const body = m.deckOp.mock.calls[0][0];
    expect(body).not.toHaveProperty("sectionId");
    expect(body).not.toHaveProperty("columnId");
    expect(body).not.toHaveProperty("index");
  });

  it("targets an explicit deck id when one is given", () => {
    actions().addOneToDeck(makeRow(), "other-deck");
    expect(m.deckOp).toHaveBeenCalledWith(expect.objectContaining({ deckId: "other-deck" }));
  });

  it("errors and places nothing on a deck-assigned row", () => {
    actions().addOneToDeck(makeRow({ deckId: "d1", deckName: "Burn" }));
    expect(m.toastError).toHaveBeenCalledWith(
      "Already in Burn — remove these copies from that deck first."
    );
    expect(m.deckOp).not.toHaveBeenCalled();
  });

  it("deck-assigned rows error even with an explicit target deck", () => {
    actions().addOneToDeck(makeRow({ deckId: "d1", deckName: "Burn" }), "other-deck");
    expect(m.deckOp).not.toHaveBeenCalled();
  });

  it("errors when there is no active deck and no explicit target", () => {
    m.state.activeDeck = null;
    actions().addOneToDeck(makeRow());
    expect(m.toastError).toHaveBeenCalledWith("Set an active deck before adding cards to a deck.");
    expect(m.deckOp).not.toHaveBeenCalled();
  });
});

describe("removeOneFromDeck", () => {
  it("removes exactly one copy (the first id) from the row's deck", () => {
    actions().removeOneFromDeck(makeRow({ deckId: "d1", deckName: "Burn" }));
    expect(m.deckOp).toHaveBeenCalledExactlyOnceWith({
      deckId: "d1",
      op: "remove",
      physicalCardId: "p1"
    });
  });

  it("is a no-op on loose rows", () => {
    actions().removeOneFromDeck(makeRow());
    expect(m.deckOp).not.toHaveBeenCalled();
    expect(m.toastError).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Shared spies + mutable context state (hoisted so the mock factories can close over them).
const m = vi.hoisted(() => ({
  create: vi.fn(),
  toastError: vi.fn(),
  state: {
    activeCollection: null as null | { _id: string },
    activeDeck: null as null | { _id: string },
    notes: "",
    tags: [] as string[]
  }
}));

vi.mock("sonner", () => ({ toast: { error: m.toastError } }));
vi.mock("@/context/OpenEntitiesContext", () => ({
  useOpenEntitiesContext: () => ({
    activeCollection: m.state.activeCollection,
    activeDeck: m.state.activeDeck
  })
}));
vi.mock("@/hooks/react-query/useCreatePhysicalCard", () => ({
  useCreatePhysicalCard: () => ({ mutate: m.create })
}));
vi.mock("@/context/SearchAddMetaContext", () => ({
  useSearchAddMeta: () => ({ notes: m.state.notes, tags: m.state.tags })
}));

import { useAddCardToActiveDeck } from "@/hooks/useAddCardToActiveDeck";

const card = { id: "card-1" } as never;

function addToDeck() {
  return renderHook(() => useAddCardToActiveDeck()).result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.activeCollection = { _id: "active-coll" };
  m.state.activeDeck = { _id: "active-deck" };
  m.state.notes = "";
  m.state.tags = [];
});

describe("useAddCardToActiveDeck", () => {
  it("creates the card in the active collection and places it in the active deck", () => {
    addToDeck()(card);
    expect(m.create).toHaveBeenCalledWith({
      cardId: "card-1",
      collectionId: "active-coll",
      deckId: "active-deck",
      notes: undefined,
      tags: undefined
    });
    expect(m.toastError).not.toHaveBeenCalled();
  });

  it("omits section/column/index so the server appends to the first column", () => {
    addToDeck()(card);
    const body = m.create.mock.calls[0][0];
    expect(body).not.toHaveProperty("sectionId");
    expect(body).not.toHaveProperty("columnId");
    expect(body).not.toHaveProperty("index");
  });

  it("targets an explicit deck id when one is given", () => {
    addToDeck()(card, "other-deck");
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ deckId: "other-deck" }));
  });

  it("errors and creates nothing when there is no active deck", () => {
    m.state.activeDeck = null;
    addToDeck()(card);
    expect(m.toastError).toHaveBeenCalledWith("Set an active deck before adding cards to a deck.");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("still works with no active deck when an explicit deck id is given", () => {
    m.state.activeDeck = null;
    addToDeck()(card, "other-deck");
    expect(m.create).toHaveBeenCalledOnce();
    expect(m.toastError).not.toHaveBeenCalled();
  });

  it("errors and creates nothing when there is no active collection", () => {
    m.state.activeCollection = null;
    addToDeck()(card);
    expect(m.toastError).toHaveBeenCalledWith(
      "Set an active collection before adding cards to a deck."
    );
    expect(m.create).not.toHaveBeenCalled();
  });

  it("passes the search page's notes and tags through", () => {
    m.state.notes = "foil";
    m.state.tags = ["trade"];
    addToDeck()(card);
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "foil", tags: ["trade"] })
    );
  });

  describe("ephemeral option", () => {
    it("creates an ephemeral copy (no collectionId) in the active deck", () => {
      addToDeck()(card, undefined, { ephemeral: true });
      expect(m.create).toHaveBeenCalledWith({
        cardId: "card-1",
        deckId: "active-deck",
        notes: undefined,
        tags: undefined
      });
      expect(m.create.mock.calls[0][0]).not.toHaveProperty("collectionId");
      expect(m.toastError).not.toHaveBeenCalled();
    });

    it("works without an active collection", () => {
      m.state.activeCollection = null;
      addToDeck()(card, undefined, { ephemeral: true });
      expect(m.create).toHaveBeenCalledOnce();
      expect(m.toastError).not.toHaveBeenCalled();
    });

    it("still requires a target deck", () => {
      m.state.activeDeck = null;
      addToDeck()(card, undefined, { ephemeral: true });
      expect(m.toastError).toHaveBeenCalledWith(
        "Set an active deck before adding cards to a deck."
      );
      expect(m.create).not.toHaveBeenCalled();
    });

    it("passes notes and tags through", () => {
      m.state.notes = "proxy";
      m.state.tags = ["wishlist"];
      addToDeck()(card, undefined, { ephemeral: true });
      expect(m.create).toHaveBeenCalledWith(
        expect.objectContaining({ notes: "proxy", tags: ["wishlist"] })
      );
    });

    it("{ ephemeral: false } behaves like the plain call", () => {
      addToDeck()(card, undefined, { ephemeral: false });
      expect(m.create).toHaveBeenCalledWith(
        expect.objectContaining({ collectionId: "active-coll", deckId: "active-deck" })
      );
    });
  });
});

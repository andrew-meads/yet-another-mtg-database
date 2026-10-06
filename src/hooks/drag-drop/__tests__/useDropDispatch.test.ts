import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Shared spies + mutable context state (hoisted so the mock factories can close over them).
const m = vi.hoisted(() => ({
  create: vi.fn(),
  move: vi.fn(),
  deck: vi.fn(),
  addCol: vi.fn(),
  addSec: vi.fn(),
  toastError: vi.fn(),
  state: { activeCollection: null as null | { _id: string } }
}));

vi.mock("sonner", () => ({ toast: { error: m.toastError } }));
vi.mock("@/context/OpenEntitiesContext", () => ({
  useOpenEntitiesContext: () => ({ activeCollection: m.state.activeCollection })
}));
vi.mock("@/hooks/react-query/useCreatePhysicalCard", () => ({
  useCreatePhysicalCard: () => ({ mutateAsync: m.create })
}));
vi.mock("@/hooks/react-query/useMovePhysicalCards", () => ({
  useMovePhysicalCards: () => ({ mutateAsync: m.move })
}));
vi.mock("@/hooks/react-query/useDeckCardOp", () => ({
  useDeckCardOp: () => ({ mutateAsync: m.deck })
}));
vi.mock("@/hooks/react-query/useDeckColumns", () => ({
  useAddColumn: () => ({ mutateAsync: m.addCol })
}));
vi.mock("@/hooks/react-query/useDeckSections", () => ({
  useAddSection: () => ({ mutateAsync: m.addSec })
}));

import { useDropDispatch } from "@/hooks/drag-drop/useDropDispatch";

function dispatcher() {
  return renderHook(() => useDropDispatch()).result.current;
}

const newCard = { kind: "new", card: { id: "card-1" } } as never;
function newCardWithMeta(notes?: string, tags?: string[]) {
  return { kind: "new", card: { id: "card-1" }, notes, tags } as never;
}
function physical(over: Record<string, unknown> = {}) {
  return {
    kind: "physical",
    physicalCardIds: ["p1"],
    card: { id: "card-1" },
    sourceCollectionId: "c1",
    sourceDeckId: null,
    origin: { type: "collection" },
    ...over
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.activeCollection = { _id: "active-coll" };
  m.addCol.mockResolvedValue({ columnId: "new-col" });
  m.addSec.mockResolvedValue({ sectionId: "new-sec" });
});

describe("useDropDispatch", () => {
  it("search → collection creates a card", async () => {
    await dispatcher()(newCard, { kind: "collection", collectionId: "c1" } as never);
    expect(m.create).toHaveBeenCalledWith({ cardId: "card-1", collectionId: "c1" });
  });

  it("search → deck creates in the active collection and places it", async () => {
    await dispatcher()(newCard, {
      kind: "deck-column",
      deckId: "d1",
      sectionId: "s1",
      columnId: "col1",
      index: 0
    } as never);
    expect(m.create).toHaveBeenCalledWith({
      cardId: "card-1",
      collectionId: "active-coll",
      deckId: "d1",
      sectionId: "s1",
      columnId: "col1",
      index: 0
    });
  });

  it("search → deck with no active collection shows an error and creates nothing", async () => {
    m.state.activeCollection = null;
    await dispatcher()(newCard, { kind: "deck-column", deckId: "d1" } as never);
    expect(m.toastError).toHaveBeenCalledOnce();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("collection → collection moves the card's collection", async () => {
    await dispatcher()(physical({ sourceCollectionId: "c1" }), {
      kind: "collection",
      collectionId: "c2"
    } as never);
    expect(m.move).toHaveBeenCalledWith({ physicalCardIds: ["p1"], collectionId: "c2" });
    expect(m.deck).not.toHaveBeenCalled();
  });

  it("collection → collection moves a multi-copy drag in one request", async () => {
    await dispatcher()(physical({ physicalCardIds: ["p1", "p2", "p3"] }), {
      kind: "collection",
      collectionId: "c2"
    } as never);
    expect(m.move).toHaveBeenCalledOnce();
    expect(m.move).toHaveBeenCalledWith({
      physicalCardIds: ["p1", "p2", "p3"],
      collectionId: "c2"
    });
  });

  it("dropping onto the same collection is a no-op", async () => {
    await dispatcher()(physical({ sourceCollectionId: "c1" }), {
      kind: "collection",
      collectionId: "c1"
    } as never);
    expect(m.move).not.toHaveBeenCalled();
  });

  it("collection → deck places every copy in one request at the drop index", async () => {
    await dispatcher()(physical({ physicalCardIds: ["p1", "p2"] }), {
      kind: "deck-column",
      deckId: "d1",
      sectionId: "s1",
      columnId: "col1",
      index: 3
    } as never);
    expect(m.deck).toHaveBeenCalledOnce();
    expect(m.deck).toHaveBeenCalledWith({
      deckId: "d1",
      op: "place",
      physicalCardIds: ["p1", "p2"],
      sectionId: "s1",
      columnId: "col1",
      index: 3
    });
  });

  it("deck → collection removes from the deck then moves collection", async () => {
    await dispatcher()(
      physical({
        physicalCardIds: ["p1", "p2"],
        sourceDeckId: "d1",
        sourceCollectionId: "c1",
        origin: { type: "deck", sectionId: "s1", columnId: "col1" }
      }),
      {
        kind: "collection",
        collectionId: "c2"
      } as never
    );
    expect(m.deck).toHaveBeenCalledOnce();
    expect(m.deck).toHaveBeenCalledWith({
      deckId: "d1",
      op: "remove",
      physicalCardIds: ["p1", "p2"]
    });
    expect(m.move).toHaveBeenCalledOnce();
    expect(m.move).toHaveBeenCalledWith({ physicalCardIds: ["p1", "p2"], collectionId: "c2" });
  });

  it("deck-assigned collection row dropped onto its own collection is a no-op", async () => {
    await dispatcher()(physical({ sourceDeckId: "d1", sourceCollectionId: "c1" }), {
      kind: "collection",
      collectionId: "c1"
    } as never);
    expect(m.deck).not.toHaveBeenCalled();
    expect(m.move).not.toHaveBeenCalled();
  });

  it("deck-assigned collection row moved to another collection keeps its deck", async () => {
    await dispatcher()(physical({ sourceDeckId: "d1", sourceCollectionId: "c1" }), {
      kind: "collection",
      collectionId: "c2"
    } as never);
    expect(m.deck).not.toHaveBeenCalled();
    expect(m.move).toHaveBeenCalledWith({ physicalCardIds: ["p1"], collectionId: "c2" });
  });

  it("search → collection passes notes and tags from the drag item", async () => {
    await dispatcher()(newCardWithMeta("foil", ["commander"]), {
      kind: "collection",
      collectionId: "c1"
    } as never);
    expect(m.create).toHaveBeenCalledWith({
      cardId: "card-1",
      collectionId: "c1",
      notes: "foil",
      tags: ["commander"]
    });
  });

  it("search → collection passes finish and condition from the drag item", async () => {
    await dispatcher()(
      { kind: "new", card: { id: "card-1" }, finish: "foil", condition: "LP" } as never,
      { kind: "collection", collectionId: "c1" } as never
    );
    expect(m.create).toHaveBeenCalledWith({
      cardId: "card-1",
      collectionId: "c1",
      finish: "foil",
      condition: "LP"
    });
  });

  it("search → deck passes notes and tags from the drag item", async () => {
    await dispatcher()(newCardWithMeta("signed", ["foil"]), {
      kind: "deck-column",
      deckId: "d1",
      sectionId: "s1",
      columnId: "col1",
      index: 0
    } as never);
    expect(m.create).toHaveBeenCalledWith({
      cardId: "card-1",
      collectionId: "active-coll",
      deckId: "d1",
      sectionId: "s1",
      columnId: "col1",
      index: 0,
      notes: "signed",
      tags: ["foil"]
    });
  });

  it("dropping on a new column creates the column first, then places into it", async () => {
    await dispatcher()(physical(), {
      kind: "deck-new-column",
      deckId: "d1",
      sectionId: "s1"
    } as never);
    expect(m.addCol).toHaveBeenCalledWith({ deckId: "d1", sectionId: "s1" });
    expect(m.deck).toHaveBeenCalledWith(
      expect.objectContaining({ deckId: "d1", columnId: "new-col", op: "place" })
    );
  });

  // --- Ephemeral (deck-only) cards ---
  const ephemeral = (over: Record<string, unknown> = {}) =>
    physical({ isEphemeral: true, sourceCollectionId: null, sourceDeckId: "d1", ...over });

  it("ephemeral → collection is a no-op", async () => {
    await dispatcher()(ephemeral(), { kind: "collection", collectionId: "c2" } as never);
    expect(m.move).not.toHaveBeenCalled();
    expect(m.deck).not.toHaveBeenCalled();
  });

  it("ephemeral → a different deck is a no-op (no column/section created)", async () => {
    await dispatcher()(ephemeral(), {
      kind: "deck-new-column",
      deckId: "d2",
      sectionId: "s2"
    } as never);
    expect(m.addCol).not.toHaveBeenCalled();
    expect(m.deck).not.toHaveBeenCalled();
  });

  it("ephemeral → its own deck reorders (place is called)", async () => {
    await dispatcher()(ephemeral(), {
      kind: "deck-column",
      deckId: "d1",
      sectionId: "s1",
      columnId: "col1",
      index: 2
    } as never);
    expect(m.deck).toHaveBeenCalledWith(
      expect.objectContaining({ deckId: "d1", op: "place", physicalCardIds: ["p1"], index: 2 })
    );
  });

  it("ephemeral → a different deck via its app-bar button is a no-op", async () => {
    await dispatcher()(ephemeral(), {
      kind: "entity-button",
      entity: { _id: "d2", kind: "deck" }
    } as never);
    expect(m.deck).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Shared spies + mutable context state (hoisted so the mock factories can close over them).
const m = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
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
vi.mock("@/hooks/react-query/useUpdatePhysicalCard", () => ({
  useUpdatePhysicalCard: () => ({ mutateAsync: m.update })
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
    expect(m.update).toHaveBeenCalledWith({ physicalCardId: "p1", collectionId: "c2" });
    expect(m.deck).not.toHaveBeenCalled();
  });

  it("dropping onto the same collection is a no-op", async () => {
    await dispatcher()(physical({ sourceCollectionId: "c1" }), {
      kind: "collection",
      collectionId: "c1"
    } as never);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("collection → deck places each copy with an incrementing index", async () => {
    await dispatcher()(physical({ physicalCardIds: ["p1", "p2"] }), {
      kind: "deck-column",
      deckId: "d1",
      sectionId: "s1",
      columnId: "col1",
      index: 3
    } as never);
    expect(m.deck).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ physicalCardId: "p1", index: 3 })
    );
    expect(m.deck).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ physicalCardId: "p2", index: 4 })
    );
  });

  it("deck → collection removes from the deck then moves collection", async () => {
    await dispatcher()(
      physical({
        sourceDeckId: "d1",
        sourceCollectionId: "c1",
        origin: { type: "deck", sectionId: "s1", columnId: "col1" }
      }),
      {
        kind: "collection",
        collectionId: "c2"
      } as never
    );
    expect(m.deck).toHaveBeenCalledWith({ deckId: "d1", op: "remove", physicalCardId: "p1" });
    expect(m.update).toHaveBeenCalledWith({ physicalCardId: "p1", collectionId: "c2" });
  });

  it("deck-assigned collection row dropped onto its own collection is a no-op", async () => {
    await dispatcher()(physical({ sourceDeckId: "d1", sourceCollectionId: "c1" }), {
      kind: "collection",
      collectionId: "c1"
    } as never);
    expect(m.deck).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("deck-assigned collection row moved to another collection keeps its deck", async () => {
    await dispatcher()(physical({ sourceDeckId: "d1", sourceCollectionId: "c1" }), {
      kind: "collection",
      collectionId: "c2"
    } as never);
    expect(m.deck).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith({ physicalCardId: "p1", collectionId: "c2" });
  });

  it("search → collection passes notes and tags from the drag item", async () => {
    await dispatcher()(
      newCardWithMeta("foil", ["commander"]),
      { kind: "collection", collectionId: "c1" } as never
    );
    expect(m.create).toHaveBeenCalledWith({
      cardId: "card-1",
      collectionId: "c1",
      notes: "foil",
      tags: ["commander"]
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
});

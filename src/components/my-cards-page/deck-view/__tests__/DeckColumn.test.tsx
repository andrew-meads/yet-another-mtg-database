import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, act } from "@testing-library/react";
import type { MtgCard } from "@/types/MtgCard";
import type { PhysicalCardDragItem } from "@/hooks/drag-drop/Types";

// Capture the props the drag source is created with, per card, in render order.
const h = vi.hoisted(() => ({
  dragCalls: [] as Array<{
    physicalCardIds: string[];
    cards: MtgCard[] | undefined;
    getItem?: () => PhysicalCardDragItem;
  }>
}));

vi.mock("@/hooks/drag-drop/usePhysicalCardDragSource", () => ({
  usePhysicalCardDragSource: (props: {
    physicalCardIds: string[];
    cards?: MtgCard[];
    getItem?: () => PhysicalCardDragItem;
  }) => {
    h.dragCalls.push({
      physicalCardIds: props.physicalCardIds,
      cards: props.cards,
      getItem: props.getItem
    });
    return { isDragging: false, dragRef: vi.fn(), draggedItem: undefined };
  }
}));

vi.mock("@/hooks/drag-drop/useDeckDropTargets", () => ({
  useDeckColumnDropTarget: () => ({ dropRef: vi.fn(), isOver: false })
}));

vi.mock("react-dnd", () => ({
  useDragLayer: () => ({ dragClientOffset: null })
}));

vi.mock("@/hooks/react-query/useDeckCardOp", () => ({
  useDeckCardOp: () => ({ mutate: vi.fn() })
}));
vi.mock("@/hooks/react-query/useDeletePhysicalCard", () => ({
  useDeletePhysicalCard: () => ({ mutate: vi.fn() })
}));
vi.mock("@/hooks/react-query/useDeckColumns", () => ({
  useDeleteColumn: () => ({ mutate: vi.fn() })
}));

// Avoid pulling in next/image + card-art rendering details for this logic test.
vi.mock("@/components/CardArtView", () => ({
  SimpleCardArtView: () => React.createElement("div", { "data-testid": "card-art" })
}));

import DeckColumn from "@/components/my-cards-page/deck-view/DeckColumn";
import type { DeckColumn as DeckColumnData } from "@/types/Deck";
import type { DetailedPhysicalCard } from "@/types/PhysicalCard";

function makeCard(id: string, ephemeral = false): DetailedPhysicalCard {
  return {
    _id: id,
    card: { id: `card-${id}`, name: id } as never,
    collectionId: ephemeral ? null : "coll-1",
    isEphemeral: ephemeral || undefined
  };
}

function makeColumn(ids: string[]): DeckColumnData {
  return { _id: "col-1", cards: ids.map((id) => makeCard(id)) };
}

function makeEphemeralColumn(ids: string[]): DeckColumnData {
  return { _id: "col-1", cards: ids.map((id) => makeCard(id, true)) };
}

beforeEach(() => {
  h.dragCalls = [];
});

describe("DeckColumn drag selection", () => {
  it("passes the grabbed card plus every card below it as physicalCardIds and cards", () => {
    render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: makeColumn(["p0", "p1", "p2", "p3"])
      })
    );

    // physicalCardIds: each card's run from that index to end
    expect(h.dragCalls.map((c) => c.physicalCardIds)).toEqual([
      ["p0", "p1", "p2", "p3"],
      ["p1", "p2", "p3"],
      ["p2", "p3"],
      ["p3"]
    ]);

    // cards: matching MtgCard objects for the same run
    expect(h.dragCalls.map((c) => c.cards?.map((m) => m.id))).toEqual([
      ["card-p0", "card-p1", "card-p2", "card-p3"],
      ["card-p1", "card-p2", "card-p3"],
      ["card-p2", "card-p3"],
      ["card-p3"]
    ]);
  });

  it("a single-card column passes exactly that one card", () => {
    render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: makeColumn(["solo"])
      })
    );
    expect(h.dragCalls[0].physicalCardIds).toEqual(["solo"]);
    expect(h.dragCalls[0].cards?.map((m) => m.id)).toEqual(["card-solo"]);
  });
});

describe("DeckColumn Alt-key single-card drag", () => {
  it("getItem() without Alt returns the full run from the grabbed card", () => {
    render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: makeColumn(["p0", "p1", "p2"])
      })
    );
    // Card at index 1 has a run of ["p1","p2"]
    const item = h.dragCalls[1].getItem?.();
    expect(item?.physicalCardIds).toEqual(["p1", "p2"]);
    expect(item?.cards?.map((c) => c.id)).toEqual(["card-p1", "card-p2"]);
  });

  it("getItem() with Alt held returns only the grabbed card", () => {
    render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: makeColumn(["p0", "p1", "p2"])
      })
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    });

    const item = h.dragCalls[1].getItem?.();
    expect(item?.physicalCardIds).toEqual(["p1"]);
    expect(item?.cards?.map((c) => c.id)).toEqual(["card-p1"]);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    });
  });

  it("getItem() reverts to run after Alt is released", () => {
    render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: makeColumn(["p0", "p1", "p2"])
      })
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    });

    const item = h.dragCalls[1].getItem?.();
    expect(item?.physicalCardIds).toEqual(["p1", "p2"]);
  });
});

describe("DeckColumn ephemeral cards", () => {
  it("renders the ephemeral badge and marks the drag item ephemeral", () => {
    const { queryByTestId } = render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: makeEphemeralColumn(["e0"])
      })
    );

    expect(queryByTestId("ephemeral-badge-e0")).not.toBeNull();
    const item = h.dragCalls[0].getItem?.();
    expect(item?.isEphemeral).toBe(true);
    expect(item?.sourceCollectionId).toBeNull();
  });

  it("does not render the ephemeral badge for a collection-backed card", () => {
    const { queryByTestId } = render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: makeColumn(["p0"])
      })
    );
    expect(queryByTestId("ephemeral-badge-p0")).toBeNull();
  });
});

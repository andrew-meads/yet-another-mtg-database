import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, act, fireEvent } from "@testing-library/react";
import type { MtgCard } from "@/types/MtgCard";
import type { PhysicalCardDragItem } from "@/hooks/drag-drop/Types";

// Capture the props the drag source is created with, per card, in render order.
const h = vi.hoisted(() => ({
  dragCalls: [] as Array<{
    physicalCardIds: string[];
    cards: MtgCard[] | undefined;
    getItem?: () => PhysicalCardDragItem;
  }>,
  computeIndex: null as ((offset: { x: number; y: number } | null) => number) | null,
  select: vi.fn()
}));

vi.mock("@/context/CardSelectionContext", () => ({
  useCardSelection: () => ({ selectedCard: null, selectedCopies: null, setSelectedCard: h.select })
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
  useDeckColumnDropTarget: (props: {
    computeIndex: (offset: { x: number; y: number } | null) => number;
  }) => {
    h.computeIndex = props.computeIndex;
    return { dropRef: vi.fn(), isOver: false };
  }
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
import { DeckZoomProvider } from "@/components/my-cards-page/deck-view/DeckZoomContext";
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
  h.select.mockClear();
});

describe("DeckColumn selection", () => {
  it("selects a clicked card together with that one copy", () => {
    const { getByTestId } = render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: {
          _id: "col-1",
          cards: [{ ...makeCard("p0"), finish: "foil", condition: "LP", collectionName: "Main" }]
        }
      })
    );
    fireEvent.click(getByTestId("deck-card-p0"));
    expect(h.select).toHaveBeenCalledWith(
      expect.objectContaining({ id: "card-p0" }),
      expect.objectContaining({
        cardId: "card-p0",
        physicalCardIds: ["p0"],
        finish: "foil",
        condition: "LP",
        isProxy: false,
        locationName: "Main"
      })
    );
  });

  it("labels an ephemeral copy as deck-only", () => {
    const { getByTestId } = render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: makeEphemeralColumn(["e0"])
      })
    );
    fireEvent.click(getByTestId("deck-card-e0"));
    expect(h.select).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ physicalCardIds: ["e0"], locationName: "this deck only" })
    );
  });
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

describe("DeckColumn attribute badges", () => {
  it("overlays finish/condition badges only for non-default copies", () => {
    const { queryAllByTestId } = render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: {
          _id: "col-1",
          cards: [makeCard("plain"), { ...makeCard("shiny"), finish: "foil", condition: "HP" }]
        }
      })
    );
    const badges = queryAllByTestId("card-attribute-badges");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("Foil");
    expect(badges[0]).toHaveTextContent("HP");
  });
});

describe("DeckColumn muted (scratch area)", () => {
  it("renders its cards partly greyscale when muted", () => {
    const { getByTestId } = render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: makeColumn(["a", "b"]),
        muted: true
      })
    );
    for (const id of ["a", "b"]) {
      const card = getByTestId(`deck-card-${id}`);
      expect(card).toHaveAttribute("data-muted", "true");
      expect(card.className).toContain("grayscale-50");
    }
  });

  it("renders its cards in full colour otherwise", () => {
    const { getByTestId } = render(
      React.createElement(DeckColumn, {
        deckId: "deck-1",
        sectionId: "sec-1",
        column: makeColumn(["a"])
      })
    );
    const card = getByTestId("deck-card-a");
    expect(card).not.toHaveAttribute("data-muted");
    expect(card.className).not.toContain("grayscale");
  });
});

describe("DeckColumn zoom", () => {
  function renderAtZoom(zoom: number | null, column: DeckColumnData) {
    const el = React.createElement(DeckColumn, { deckId: "deck-1", sectionId: "sec-1", column });
    return render(zoom === null ? el : React.createElement(DeckZoomProvider, { zoom }, el));
  }

  it("uses the 100% card size outside a zoom provider", () => {
    const { getByTestId } = renderAtZoom(null, makeColumn(["a", "b"]));
    expect(getByTestId("deck-card-a")).toHaveStyle({ width: "146px", height: "204px" });
    expect(getByTestId("deck-card-b")).toHaveStyle({ marginTop: "-174px" });
  });

  it("scales the cards and their overlap", () => {
    const { getByTestId } = renderAtZoom(50, makeColumn(["a", "b"]));
    expect(getByTestId("deck-card-a")).toHaveStyle({ width: "73px", height: "102px" });
    // 102px card, 15px of it showing above the next one.
    expect(getByTestId("deck-card-b")).toHaveStyle({ marginTop: "-87px" });
  });

  it("scales an empty column's placeholder", () => {
    const { getByText } = renderAtZoom(150, { _id: "col-1", cards: [] });
    expect(getByText("Drop here")).toHaveStyle({ width: "219px", height: "306px" });
  });

  it("computes the drop index from the zoomed overlap", () => {
    renderAtZoom(50, makeColumn(["a", "b", "c", "d"]));
    // jsdom puts the column at y=0; 5px of column chrome, then 15px per card.
    expect(h.computeIndex?.({ x: 0, y: 5 + 15 * 2 + 1 })).toBe(2);
    expect(h.computeIndex?.({ x: 0, y: 5 + 15 * 2 - 1 })).toBe(1);
  });

  it("hides the overlay badges when zoomed too far out", () => {
    const column: DeckColumnData = {
      _id: "col-1",
      cards: [{ ...makeCard("e0", true), finish: "foil" }]
    };
    const zoomedOut = renderAtZoom(30, column);
    expect(zoomedOut.queryByTestId("ephemeral-badge-e0")).toBeNull();
    expect(zoomedOut.queryByTestId("card-attribute-badges")).toBeNull();
    zoomedOut.unmount();

    const zoomedIn = renderAtZoom(60, column);
    expect(zoomedIn.queryByTestId("ephemeral-badge-e0")).not.toBeNull();
    expect(zoomedIn.queryByTestId("card-attribute-badges")).not.toBeNull();
  });
});

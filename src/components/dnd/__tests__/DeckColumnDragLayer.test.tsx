import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import type { MtgCard } from "@/types/MtgCard";
import { PHYSICAL_CARD, PhysicalCardDragOrigin } from "@/hooks/drag-drop/Types";

// Control what useDragLayer returns per test.
const h = vi.hoisted(() => ({
  dragState: {
    item: null as null | Record<string, unknown>,
    itemType: null as string | null,
    currentOffset: null as null | { x: number; y: number }
  }
}));

vi.mock("react-dnd", () => ({
  useDragLayer: (collect: (monitor: unknown) => unknown) =>
    collect({
      getItem: () => h.dragState.item,
      getItemType: () => h.dragState.itemType,
      getClientOffset: () => h.dragState.currentOffset
    })
}));

vi.mock("@/components/CardArtView", () => ({
  SimpleCardArtView: ({ card }: { card: MtgCard }) =>
    React.createElement("div", { "data-testid": `card-art-${card.id}` })
}));

import DeckColumnDragLayer from "@/components/dnd/DeckColumnDragLayer";

function makeCard(id: string): MtgCard {
  return { id, name: id } as MtgCard;
}

function activeDrag(opts: {
  origin: PhysicalCardDragOrigin;
  physicalCardIds: string[];
  card?: MtgCard;
  cards?: MtgCard[];
  sourceCollectionName?: string;
  sourceDeckName?: string;
}) {
  h.dragState = {
    item: {
      kind: "physical",
      physicalCardIds: opts.physicalCardIds,
      card: opts.card ?? makeCard("c1"),
      cards: opts.cards,
      origin: opts.origin,
      sourceCollectionName: opts.sourceCollectionName,
      sourceDeckName: opts.sourceDeckName
    },
    itemType: PHYSICAL_CARD,
    currentOffset: { x: 200, y: 300 }
  };
}

function reset() {
  h.dragState = { item: null, itemType: null, currentOffset: null };
}

describe("DeckColumnDragLayer", () => {
  it("renders nothing when there is no active drag", () => {
    reset();
    const { container } = render(React.createElement(DeckColumnDragLayer));
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the item type does not match", () => {
    reset();
    h.dragState = {
      item: { kind: "new", card: makeCard("c1") },
      itemType: "NEW_CARD",
      currentOffset: { x: 0, y: 0 }
    };
    const { container } = render(React.createElement(DeckColumnDragLayer));
    expect(container.firstChild).toBeNull();
  });

  it("repeats the card to the group count for a collection-row drag", () => {
    reset();
    activeDrag({ origin: { type: "collection" }, physicalCardIds: ["a", "b", "c", "d"] });
    render(React.createElement(DeckColumnDragLayer));
    expect(screen.getAllByTestId(/^card-art-/)).toHaveLength(4);
    expect(screen.getByText("×4")).toBeInTheDocument();
  });

  it("shows no count badge for a single-card drag", () => {
    reset();
    activeDrag({ origin: { type: "collection" }, physicalCardIds: ["a"] });
    render(React.createElement(DeckColumnDragLayer));
    expect(screen.getAllByTestId(/^card-art-/)).toHaveLength(1);
    expect(screen.queryByText("×1")).not.toBeInTheDocument();
  });

  it("renders each distinct card for a deck-run drag", () => {
    reset();
    const cards = [makeCard("a"), makeCard("b"), makeCard("c")];
    activeDrag({
      origin: { type: "deck", sectionId: "s", columnId: "col" },
      physicalCardIds: ["a", "b", "c"],
      cards
    });
    render(React.createElement(DeckColumnDragLayer));
    expect(screen.getByTestId("card-art-a")).toBeInTheDocument();
    expect(screen.getByTestId("card-art-b")).toBeInTheDocument();
    expect(screen.getByTestId("card-art-c")).toBeInTheDocument();
    expect(screen.getByText("×3")).toBeInTheDocument();
  });

  it("caps the visible stack at 6 cards but still shows the true count", () => {
    reset();
    const ids = Array.from({ length: 10 }, (_, i) => `card-${i}`);
    activeDrag({
      origin: { type: "deck", sectionId: "s", columnId: "col" },
      physicalCardIds: ids,
      cards: ids.map(makeCard)
    });
    render(React.createElement(DeckColumnDragLayer));
    expect(screen.getAllByTestId(/^card-art-/)).toHaveLength(6);
    expect(screen.getByText("×10")).toBeInTheDocument();
  });

  it("renders membership badges for source collection and deck", () => {
    reset();
    activeDrag({
      origin: { type: "collection" },
      physicalCardIds: ["a"],
      sourceCollectionName: "Main Collection",
      sourceDeckName: "Mono Red"
    });
    render(React.createElement(DeckColumnDragLayer));
    expect(screen.getByText("Main Collection")).toBeInTheDocument();
    expect(screen.getByText("Mono Red")).toBeInTheDocument();
  });
});

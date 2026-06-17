import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import type { MtgCard } from "@/types/MtgCard";
import { PHYSICAL_CARD } from "@/hooks/drag-drop/Types";

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

function activeDrag(cards?: MtgCard[]) {
  h.dragState = {
    item: {
      kind: "physical",
      physicalCardIds: (cards ?? [makeCard("c1")]).map((c) => c.id),
      card: makeCard("c1"),
      cards
    },
    itemType: PHYSICAL_CARD,
    currentOffset: { x: 200, y: 300 }
  };
}

function resetDrag() {
  h.dragState = { item: null, itemType: null, currentOffset: null };
}

describe("DeckColumnDragLayer", () => {
  it("renders nothing when there is no active drag", () => {
    resetDrag();
    const { container } = render(React.createElement(DeckColumnDragLayer));
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the item type does not match", () => {
    h.dragState = {
      item: { kind: "new", card: makeCard("c1") },
      itemType: "NEW_CARD",
      currentOffset: { x: 0, y: 0 }
    };
    const { container } = render(React.createElement(DeckColumnDragLayer));
    expect(container.firstChild).toBeNull();
  });

  it("renders a single card when item.cards is absent (collection-row fallback)", () => {
    activeDrag(undefined);
    render(React.createElement(DeckColumnDragLayer));
    expect(screen.getAllByTestId(/^card-art-/)).toHaveLength(1);
  });

  it("renders all cards when item.cards has multiple entries", () => {
    activeDrag([makeCard("a"), makeCard("b"), makeCard("c")]);
    render(React.createElement(DeckColumnDragLayer));
    expect(screen.getAllByTestId(/^card-art-/)).toHaveLength(3);
    expect(screen.getByTestId("card-art-a")).toBeInTheDocument();
    expect(screen.getByTestId("card-art-b")).toBeInTheDocument();
    expect(screen.getByTestId("card-art-c")).toBeInTheDocument();
  });

  it("caps the visible stack at 6 cards", () => {
    activeDrag(Array.from({ length: 10 }, (_, i) => makeCard(`card-${i}`)));
    render(React.createElement(DeckColumnDragLayer));
    expect(screen.getAllByTestId(/^card-art-/)).toHaveLength(6);
  });
});

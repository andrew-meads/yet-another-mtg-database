import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

vi.mock("@/hooks/react-query/useDeckSections", () => ({
  useUpdateSection: () => ({ mutate: vi.fn() }),
  useDeleteSection: () => ({ mutate: vi.fn() })
}));
vi.mock("@/hooks/react-query/useDeckColumns", () => ({
  useAddColumn: () => ({ mutate: vi.fn() }),
  useDeleteColumn: () => ({ mutate: vi.fn() })
}));
vi.mock("@/hooks/drag-drop/useDeckDropTargets", () => ({
  useDeckNewColumnDropTarget: () => ({ dropRef: vi.fn(), isOver: false }),
  useDeckColumnDropTarget: () => ({ dropRef: vi.fn(), isOver: false })
}));
vi.mock("@/components/my-cards-page/deck-view/AddBasicLandButton", () => ({
  default: () => React.createElement("div")
}));
vi.mock("@/components/my-cards-page/deck-view/DeckColumn", () => ({
  default: () => React.createElement("div", { "data-testid": "deck-column" })
}));

import DeckSection from "@/components/my-cards-page/deck-view/DeckSection";
import type { DeckSection as DeckSectionData } from "@/types/Deck";

function makeSection(columnSizes: number[]): DeckSectionData {
  return {
    _id: "sec-1",
    name: "Creatures",
    columns: columnSizes.map((size, i) => ({
      _id: `col-${i}`,
      cards: Array.from({ length: size }, (_, j) => ({
        _id: `p-${i}-${j}`,
        card: { id: `card-${i}-${j}`, name: "x" } as never,
        collectionId: "coll-1"
      }))
    }))
  };
}

function renderSection(section: DeckSectionData) {
  return render(React.createElement(DeckSection, { deckId: "deck-1", section }));
}

describe("DeckSection card count", () => {
  it("shows the total across every column next to the section name", () => {
    const { getByTestId } = renderSection(makeSection([3, 4, 1]));
    expect(getByTestId("section-card-count-sec-1").textContent).toBe("8 cards");
  });

  it("shows a singular label for one card", () => {
    const { getByTestId } = renderSection(makeSection([1]));
    expect(getByTestId("section-card-count-sec-1").textContent).toBe("1 card");
  });

  it("shows zero for an empty section", () => {
    const { getByTestId } = renderSection(makeSection([0, 0]));
    expect(getByTestId("section-card-count-sec-1").textContent).toBe("0 cards");
  });
});

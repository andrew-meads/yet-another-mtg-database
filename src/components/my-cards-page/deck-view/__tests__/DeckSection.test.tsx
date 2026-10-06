import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  updateSection: vi.fn(),
  columnProps: [] as Array<{ muted?: boolean }>
}));

vi.mock("@/hooks/react-query/useDeckSections", () => ({
  useUpdateSection: () => ({ mutate: h.updateSection }),
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
  default: (props: { muted?: boolean }) => {
    h.columnProps.push(props);
    return React.createElement("div", { "data-testid": "deck-column" });
  }
}));

import DeckSection from "@/components/my-cards-page/deck-view/DeckSection";
import type { DeckSection as DeckSectionData, DeckSectionKind } from "@/types/Deck";

// Radix Select needs pointer-capture + scrollIntoView APIs jsdom doesn't ship.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  h.updateSection.mockClear();
  h.columnProps = [];
});

function makeSection(columnSizes: number[], kind?: DeckSectionKind): DeckSectionData {
  return {
    _id: "sec-1",
    name: "Creatures",
    ...(kind ? { kind } : {}),
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

describe("DeckSection kind", () => {
  it("shows Normal for a section with no stored kind", () => {
    renderSection(makeSection([2]));
    expect(screen.getByRole("combobox", { name: "Section type" })).toHaveTextContent("Normal");
    expect(screen.getByTestId("section-card-count-sec-1").textContent).toBe("2 cards");
  });

  it("labels a sideboard's count as sideboard cards", () => {
    renderSection(makeSection([3], "sideboard"));
    expect(screen.getByRole("combobox", { name: "Section type" })).toHaveTextContent("Sideboard");
    expect(screen.getByTestId("section-card-count-sec-1").textContent).toBe("3 cards in sideboard");
  });

  it("marks a scratch area as not counted and mutes its columns", () => {
    renderSection(makeSection([1, 2], "scratch"));
    expect(screen.getByRole("combobox", { name: "Section type" })).toHaveTextContent(
      "Scratch area"
    );
    expect(screen.getByTestId("section-card-count-sec-1").textContent).toBe(
      "3 cards (not counted)"
    );
    expect(h.columnProps.length).toBeGreaterThan(0);
    expect(h.columnProps.every((p) => p.muted === true)).toBe(true);
  });

  it("does not mute the columns of a normal or sideboard section", () => {
    renderSection(makeSection([1], "sideboard"));
    renderSection(makeSection([1]));
    expect(h.columnProps.every((p) => !p.muted)).toBe(true);
  });

  it("saves a newly chosen kind", async () => {
    const user = userEvent.setup();
    renderSection(makeSection([1]));
    await user.click(screen.getByRole("combobox", { name: "Section type" }));
    await user.click(await screen.findByRole("option", { name: "Sideboard" }));
    expect(h.updateSection).toHaveBeenCalledWith({
      deckId: "deck-1",
      sectionId: "sec-1",
      kind: "sideboard"
    });
  });

  it("does not save when the same kind is picked again", async () => {
    const user = userEvent.setup();
    renderSection(makeSection([1], "scratch"));
    await user.click(screen.getByRole("combobox", { name: "Section type" }));
    await user.click(await screen.findByRole("option", { name: "Scratch area" }));
    expect(h.updateSection).not.toHaveBeenCalled();
  });
});

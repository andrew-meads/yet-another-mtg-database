import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MtgCard } from "@/types/MtgCard";
import type { CollectionGroupRow } from "@/components/my-cards-page/collection-view/grouping";
import type { PhysicalCardDragItem } from "@/hooks/drag-drop/Types";

// Capture the props handed to the (mocked) drag source so we can invoke its getItem and
// assert the exact id slice the row would drag.
const m = vi.hoisted(() => ({
  getItem: undefined as undefined | (() => PhysicalCardDragItem),
  create: vi.fn(),
  remove: vi.fn()
}));

vi.mock("@/hooks/drag-drop/usePhysicalCardDragSource", () => ({
  usePhysicalCardDragSource: (props: { getItem?: () => PhysicalCardDragItem }) => {
    m.getItem = props.getItem;
    return { isDragging: false, dragRef: () => {}, draggedItem: undefined };
  }
}));
vi.mock("@/hooks/react-query/useCreatePhysicalCard", () => ({
  useCreatePhysicalCard: () => ({ mutate: m.create })
}));
vi.mock("@/hooks/react-query/useRemoveCardGroup", () => ({
  useRemoveCardGroup: () => ({ mutate: m.remove })
}));

import CollectionTableRow from "@/components/my-cards-page/collection-view/CollectionTableRow";

const card = {
  id: "card-1",
  name: "Lightning Bolt",
  type_line: "Instant",
  mana_cost: "{R}",
  cmc: 1,
  set: "lea",
  set_name: "Limited Edition Alpha",
  rarity: "common"
} as unknown as MtgCard;

function makeRow(over: Partial<CollectionGroupRow> = {}): CollectionGroupRow {
  return {
    key: "k1",
    card,
    deckId: null,
    physicalCardIds: ["p1", "p2", "p3", "p4"],
    quantity: 4,
    ...over
  };
}

function renderRow(row: CollectionGroupRow, onClick = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CollectionTableRow collectionId="c1" collectionName="Main" row={row} onClick={onClick} />
    </QueryClientProvider>
  );
  return { onClick };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getItem = undefined;
});

describe("CollectionTableRow drag-count control", () => {
  it("renders the drag-count control for a multi-copy row", () => {
    renderRow(makeRow());
    expect(screen.getByLabelText("Drag handle")).toBeInTheDocument();
    expect(screen.getByLabelText("Decrease drag amount")).toBeInTheDocument();
    expect(screen.getByLabelText("Increase drag amount")).toBeInTheDocument();
  });

  it("does not render the control for a single-copy row", () => {
    renderRow(makeRow({ physicalCardIds: ["p1"], quantity: 1 }));
    expect(screen.queryByLabelText("Drag handle")).not.toBeInTheDocument();
  });

  it("drags every copy by default", () => {
    renderRow(makeRow());
    expect(m.getItem?.().physicalCardIds).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("decreasing the count slices the dragged ids and does not select the card", () => {
    const { onClick } = renderRow(makeRow());
    fireEvent.click(screen.getByLabelText("Decrease drag amount"));
    fireEvent.click(screen.getByLabelText("Decrease drag amount"));
    expect(onClick).not.toHaveBeenCalled();
    expect(m.getItem?.().physicalCardIds).toEqual(["p1", "p2"]);
  });

  it("drags a single copy while Alt is held, regardless of the count", () => {
    renderRow(makeRow());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    });
    expect(m.getItem?.().physicalCardIds).toEqual(["p1"]);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    });
  });
});

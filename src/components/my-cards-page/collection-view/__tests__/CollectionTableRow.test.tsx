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
  remove: vi.fn(),
  moveOneToCollection: vi.fn(),
  addOneToDeck: vi.fn(),
  removeOneFromDeck: vi.fn(),
  state: {
    activeCollection: null as null | { _id: string; name: string },
    activeDeck: null as null | { _id: string; name: string },
    openEntities: [] as { _id: string; name: string; kind: "collection" | "deck" }[]
  }
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
vi.mock("@/context/OpenEntitiesContext", () => ({
  useOpenEntitiesContext: () => ({
    activeCollection: m.state.activeCollection,
    activeDeck: m.state.activeDeck,
    openEntities: m.state.openEntities
  })
}));
vi.mock("@/hooks/useCollectionRowActions", () => ({
  useCollectionRowActions: () => ({
    moveOneToCollection: m.moveOneToCollection,
    addOneToDeck: m.addOneToDeck,
    removeOneFromDeck: m.removeOneFromDeck
  })
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
    finish: "nonfoil",
    condition: "NM",
    isProxy: false,
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
  m.state.activeCollection = { _id: "active-coll", name: "Active Collection" };
  m.state.activeDeck = { _id: "active-deck", name: "Active Deck" };
  m.state.openEntities = [
    { _id: "c1", name: "Main", kind: "collection" },
    { _id: "other-coll", name: "Trade Binder", kind: "collection" },
    { _id: "deck-1", name: "Burn", kind: "deck" }
  ];
});

describe("CollectionTableRow drag-count control", () => {
  it("renders the drag-count control for a multi-copy row", () => {
    renderRow(makeRow());
    expect(screen.getByLabelText("Drag handle")).toBeInTheDocument();
    expect(screen.getByLabelText("Decrease drag amount")).toBeInTheDocument();
    expect(screen.getByLabelText("Increase drag amount")).toBeInTheDocument();
  });

  it("renders the control for a single-copy row", () => {
    renderRow(makeRow({ physicalCardIds: ["p1"], quantity: 1 }));
    expect(screen.getByLabelText("Drag handle")).toBeInTheDocument();
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

describe("CollectionTableRow context menu", () => {
  function openMenu(row: CollectionGroupRow) {
    renderRow(row);
    fireEvent.contextMenu(screen.getByTestId(`collection-row-${row.key}`));
  }

  function menuItemFor(text: RegExp) {
    const item = screen.getByText(text).closest('[role="menuitem"]');
    expect(item).not.toBeNull();
    return item!;
  }

  it("fires moveOneToCollection for the active-collection item", () => {
    const row = makeRow();
    openMenu(row);
    fireEvent.click(menuItemFor(/Move copy to active collection/));
    expect(m.moveOneToCollection).toHaveBeenCalledExactlyOnceWith(row);
  });

  it("disables the active-collection item when this collection is active", () => {
    m.state.activeCollection = { _id: "c1", name: "Main" };
    openMenu(makeRow());
    expect(menuItemFor(/Move copy to active collection/)).toHaveAttribute("data-disabled");
    expect(screen.getByText(/\(this collection\)/)).toBeInTheDocument();
  });

  it("fires addOneToDeck for the active-deck item on a loose row", () => {
    const row = makeRow();
    openMenu(row);
    fireEvent.click(menuItemFor(/Add copy to active deck/));
    expect(m.addOneToDeck).toHaveBeenCalledExactlyOnceWith(row);
  });

  it("disables deck actions on a deck-assigned row, with a hint", () => {
    openMenu(makeRow({ deckId: "deck-1", deckName: "Burn" }));
    expect(menuItemFor(/Add copy to active deck/)).toHaveAttribute("data-disabled");
    expect(screen.getByText(/In Burn — remove it from that deck first/)).toBeInTheDocument();
    expect(menuItemFor(/Add copy to deck/)).toHaveAttribute("data-disabled");
  });

  it("lists open collections in the move submenu (current one disabled)", () => {
    openMenu(makeRow());
    expect(menuItemFor(/Move copy to collection/)).not.toHaveAttribute("data-disabled");
  });

  it("shows Remove copy from deck only on deck-assigned rows and fires removeOneFromDeck", () => {
    const row = makeRow({ deckId: "deck-1", deckName: "Burn" });
    openMenu(row);
    fireEvent.click(menuItemFor(/Remove copy from deck/));
    expect(m.removeOneFromDeck).toHaveBeenCalledExactlyOnceWith(row);
  });

  it("hides Remove copy from deck on loose rows", () => {
    openMenu(makeRow());
    expect(screen.queryByText(/Remove copy from deck/)).not.toBeInTheDocument();
  });

  it("Add another copy carries the row's non-default finish/condition only", () => {
    openMenu(makeRow({ finish: "foil", condition: "NM" }));
    fireEvent.click(menuItemFor(/Add another copy/));
    expect(m.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ cardId: "card-1", finish: "foil", quantity: 1 })
    );
    expect(m.create.mock.calls[0][0]).not.toHaveProperty("condition");
  });

  it("Delete a copy targets the row's finish and condition group", () => {
    openMenu(makeRow({ finish: "etched", condition: "MP" }));
    fireEvent.click(menuItemFor(/Delete a copy/));
    expect(m.remove).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ finish: "etched", condition: "MP", quantity: 1 })
    );
  });

  it("Add another copy creates exactly one copy in this collection", () => {
    openMenu(makeRow());
    fireEvent.click(menuItemFor(/Add another copy/));
    expect(m.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ cardId: "card-1", collectionId: "c1", quantity: 1 })
    );
  });

  it("Delete a copy removes exactly one copy", () => {
    openMenu(makeRow());
    fireEvent.click(menuItemFor(/Delete a copy/));
    expect(m.remove).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ cardId: "card-1", collectionId: "c1", quantity: 1 })
    );
  });
});

describe("CollectionTableRow attribute badges", () => {
  it("shows no badges for an ordinary non-foil / NM row", () => {
    renderRow(makeRow());
    expect(screen.queryByTestId("card-attribute-badges")).not.toBeInTheDocument();
  });

  it("shows finish and condition badges when they differ from the defaults", () => {
    renderRow(makeRow({ finish: "foil", condition: "LP" }));
    const badges = screen.getByTestId("card-attribute-badges");
    expect(badges).toHaveTextContent("Foil");
    expect(badges).toHaveTextContent("LP");
  });
});

describe("CollectionTableRow price column", () => {
  const quote = {
    prices: {
      usd: "1.50",
      usd_foil: "4.00",
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null
    },
    updatedAt: new Date().toISOString()
  };

  it("renders no price cell unless showPrice is set", () => {
    renderRow(makeRow());
    expect(screen.queryByTestId("price-tag")).not.toBeInTheDocument();
  });

  it("shows the printing's finish price as a stale estimate when the copies were never priced", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CollectionTableRow
          collectionId="c1"
          row={makeRow({ finish: "foil", quantity: 3 })}
          showPrice
          priceQuote={quote}
        />
      </QueryClientProvider>
    );
    const tag = screen.getByTestId("price-tag");
    expect(tag).toHaveTextContent("$4.00");
    expect(tag).toHaveAttribute("data-price-kind", "estimate");
    expect(tag.querySelector("[data-age-level]")).toHaveAttribute("data-age-level", "stale");
    expect(tag.querySelector("[data-age-level]")).toHaveAccessibleName(
      /Estimated from the printing/
    );
    expect(screen.getByRole("button", { name: "Refresh price" })).toBeInTheDocument();
  });

  it("shows the copies' own price with its real age once they have been priced", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CollectionTableRow
          collectionId="c1"
          row={makeRow({
            finish: "foil",
            condition: "LP",
            quantity: 2,
            copyPrice: {
              usd: 3.5,
              source: "manapool",
              conditionMatched: true,
              updatedAt: new Date().toISOString()
            }
          })}
          showPrice
          priceQuote={quote}
        />
      </QueryClientProvider>
    );
    const tag = screen.getByTestId("price-tag");
    expect(tag).toHaveTextContent("$3.50");
    expect(tag).toHaveAttribute("data-price-kind", "copy");
    expect(tag.querySelector("[data-age-level]")).toHaveAttribute("data-age-level", "fresh");
  });

  it("shows $0 for a proxy row, with no age dot and no refresh", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CollectionTableRow
          collectionId="c1"
          row={makeRow({ tags: ["Proxy"], isProxy: true, quantity: 2 })}
          showPrice
          priceQuote={quote}
        />
      </QueryClientProvider>
    );
    const tag = screen.getByTestId("price-tag");
    expect(tag).toHaveTextContent("$0.00");
    expect(tag).toHaveAttribute("data-price-kind", "proxy");
    expect(tag.querySelector("[data-age-level]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh price" })).not.toBeInTheDocument();
  });
});

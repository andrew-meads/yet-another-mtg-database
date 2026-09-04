import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SlimMtgCard } from "@/types/MtgCard";
import type { DetailedPhysicalCard } from "@/types/PhysicalCard";
import type { CollectionWithCards } from "@/types/Collection";
import type { CollectionGroupRow } from "@/components/my-cards-page/collection-view/grouping";

const m = vi.hoisted(() => ({
  moveOneToCollection: vi.fn(),
  addOneToDeck: vi.fn()
}));

vi.mock("@/hooks/drag-drop/useCollectionDropTarget", () => ({
  useCollectionDropTarget: () => ({ dropRef: () => {}, isOver: false })
}));
vi.mock("@/hooks/useCollectionRowActions", () => ({
  useCollectionRowActions: () => ({
    moveOneToCollection: m.moveOneToCollection,
    addOneToDeck: m.addOneToDeck
  })
}));
vi.mock("@/context/CardSelectionContext", () => ({
  useCardSelection: () => ({ setSelectedCard: vi.fn() })
}));
vi.mock("@/context/SettingsContext", () => ({
  useCardPreviewSettings: () => ({
    cardPreview: { enabled: false, size: "normal", delayMs: 500 }
  })
}));
vi.mock("@/components/search/CardSearchBar", () => ({
  default: () => <div data-testid="search-bar" />
}));
vi.mock("@/components/my-cards-page/collection-view/CollectionTableRow", () => ({
  default: ({
    row,
    onClick
  }: {
    row: CollectionGroupRow;
    onClick?: (card: CollectionGroupRow["card"]) => void;
  }) => (
    <div data-testid="collection-row" onClick={() => onClick?.(row.card)}>
      {row.card.name}
      {row.deckName ? ` (${row.deckName})` : ""}
    </div>
  )
}));
// jsdom has no layout, so the real virtualizer renders nothing — render every row.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 44 })),
    measureElement: () => {},
    scrollToIndex: () => {}
  })
}));

import CollectionTable from "@/components/my-cards-page/collection-view/CollectionTable";

function makeCard(overrides: Partial<SlimMtgCard> = {}): SlimMtgCard {
  return {
    id: "card-1",
    name: "Lightning Bolt",
    set: "lea",
    set_name: "Limited Edition Alpha",
    released_at: "1993-08-05",
    collector_number: "1",
    ...overrides
  } as SlimMtgCard;
}

function makePhysical(
  _id: string,
  card: SlimMtgCard,
  overrides: Partial<DetailedPhysicalCard> = {}
): DetailedPhysicalCard {
  return { _id, card, collectionId: "coll-1", ...overrides } as DetailedPhysicalCard;
}

function makeCollection(cards: DetailedPhysicalCard[]): CollectionWithCards {
  return {
    _id: "coll-1",
    name: "Main Collection",
    kind: "collection",
    owner: "u1",
    description: "",
    cards
  };
}

function renderTable(cards: DetailedPhysicalCard[], initialQuery?: string) {
  render(
    <CollectionTable
      collection={makeCollection(cards)}
      initialQuery={initialQuery}
      onSearchChange={() => {}}
    />
  );
}

const bolt = makeCard();
const shock = makeCard({ id: "card-2", name: "Shock" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CollectionTable hide-cards-in-decks toggle", () => {
  it("shows all rows and the full count by default", () => {
    renderTable([
      makePhysical("p1", bolt),
      makePhysical("p2", bolt, { deckId: "d1", deckName: "Burn" }),
      makePhysical("p3", shock)
    ]);
    expect(screen.getAllByTestId("collection-row")).toHaveLength(3);
    expect(screen.getByText("3 cards")).toBeInTheDocument();
  });

  it("hides deck-assigned rows when toggled and restores them when toggled off", () => {
    renderTable([
      makePhysical("p1", bolt),
      makePhysical("p2", bolt, { deckId: "d1", deckName: "Burn" }),
      makePhysical("p3", shock)
    ]);
    const toggle = screen.getByLabelText("Hide cards in decks");

    fireEvent.click(toggle);
    const rows = screen.getAllByTestId("collection-row");
    expect(rows).toHaveLength(2);
    expect(screen.queryByText(/Burn/)).not.toBeInTheDocument();
    expect(screen.getByText("2 cards")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    expect(screen.getAllByTestId("collection-row")).toHaveLength(3);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("explains when the filter hides every row", () => {
    renderTable([makePhysical("p1", bolt, { deckId: "d1", deckName: "Burn" })]);
    fireEvent.click(screen.getByLabelText("Hide cards in decks"));
    expect(screen.getByText("All matching cards are in decks")).toBeInTheDocument();
  });
});

describe("CollectionTable empty states", () => {
  it("says the collection is empty when there are no cards and no query", () => {
    renderTable([]);
    expect(screen.getByText("No cards in this collection")).toBeInTheDocument();
  });

  it("says nothing matched for an ordinary query with no results", () => {
    renderTable([], "t:dreadnought");
    expect(screen.getByText("No cards match your search")).toBeInTheDocument();
    expect(screen.queryByTestId("noughty-easter-egg")).not.toBeInTheDocument();
  });

  it("reveals the mascot when the query is the mascot's name", () => {
    renderTable([], "noughty the dreadnought");
    expect(screen.getByTestId("noughty-easter-egg")).toBeInTheDocument();
    expect(screen.queryByText("No cards match your search")).not.toBeInTheDocument();
  });

  it("keeps showing real rows even when the query is the mascot's name", () => {
    // The server decides what matches; the egg only replaces an *empty* result.
    renderTable([makePhysical("p1", bolt)], "noughty the dreadnought");
    expect(screen.getByTestId("collection-row")).toBeInTheDocument();
    expect(screen.queryByTestId("noughty-easter-egg")).not.toBeInTheDocument();
  });
});

describe("CollectionTable keyboard shortcuts", () => {
  function renderAndSelect(name: string) {
    renderTable([makePhysical("p1", bolt), makePhysical("p2", shock)]);
    fireEvent.click(screen.getByText(name));
    const container = document.querySelector<HTMLElement>('[tabindex="0"]')!;
    container.focus();
  }

  it("d sends the selected row to the active deck", () => {
    renderAndSelect("Shock");
    fireEvent.keyDown(document, { key: "d" });
    expect(m.addOneToDeck).toHaveBeenCalledOnce();
    expect(m.addOneToDeck.mock.calls[0][0].card.name).toBe("Shock");
  });

  it("+ and = move the selected row to the active collection", () => {
    renderAndSelect("Lightning Bolt");
    fireEvent.keyDown(document, { key: "+" });
    fireEvent.keyDown(document, { key: "=" });
    expect(m.moveOneToCollection).toHaveBeenCalledTimes(2);
    expect(m.moveOneToCollection.mock.calls[0][0].card.name).toBe("Lightning Bolt");
  });

  it("ignores d with modifiers and shift", () => {
    renderAndSelect("Shock");
    fireEvent.keyDown(document, { key: "d", metaKey: true });
    fireEvent.keyDown(document, { key: "D", shiftKey: true });
    expect(m.addOneToDeck).not.toHaveBeenCalled();
  });

  it("does nothing when no row is selected", () => {
    renderTable([makePhysical("p1", bolt)]);
    document.querySelector<HTMLElement>('[tabindex="0"]')!.focus();
    fireEvent.keyDown(document, { key: "d" });
    fireEvent.keyDown(document, { key: "+" });
    expect(m.addOneToDeck).not.toHaveBeenCalled();
    expect(m.moveOneToCollection).not.toHaveBeenCalled();
  });
});

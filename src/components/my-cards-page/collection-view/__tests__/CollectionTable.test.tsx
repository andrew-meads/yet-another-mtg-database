import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SlimMtgCard } from "@/types/MtgCard";
import type { DetailedPhysicalCard } from "@/types/PhysicalCard";
import type { CollectionWithCards } from "@/types/Collection";
import type { CollectionGroupRow } from "@/components/my-cards-page/collection-view/grouping";

const m = vi.hoisted(() => ({
  moveOneToCollection: vi.fn(),
  addOneToDeck: vi.fn(),
  setSelectedCard: vi.fn(),
  quotes: {} as Record<string, { prices: Record<string, string | null>; updatedAt: string | null }>,
  priceRequests: [] as Array<{ ids: string[]; enabled: boolean }>
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
  useCardSelection: () => ({ setSelectedCard: m.setSelectedCard, selectedCopies: null })
}));
vi.mock("@/context/SettingsContext", () => ({
  useCardPreviewSettings: () => ({
    cardPreview: { enabled: false, size: "normal", delayMs: 500 }
  })
}));
vi.mock("@/components/search/CardSearchBar", () => ({
  default: () => <div data-testid="search-bar" />
}));
// Price quotes + currency have their own tests; stub them (and record requests).
vi.mock("@/hooks/react-query/useCardPriceQuotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/react-query/useCardPriceQuotes")>();
  return {
    ...actual,
    useCardPriceQuotes: (ids: string[], options?: { enabled?: boolean }) => {
      m.priceRequests.push({ ids, enabled: options?.enabled ?? true });
      return { quotes: m.quotes, isLoading: false, error: null };
    }
  };
});
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    currency: "USD",
    configured: "USD",
    rate: 1,
    loading: false,
    format: (usd: number | null) => (usd === null ? null : `$${usd.toFixed(2)}`)
  })
}));
vi.mock("@/components/my-cards-page/collection-view/CollectionTableRow", () => ({
  default: ({
    row,
    onClick,
    showPrice
  }: {
    row: CollectionGroupRow;
    onClick?: (card: CollectionGroupRow["card"]) => void;
    showPrice?: boolean;
  }) => (
    <div
      data-testid="collection-row"
      data-show-price={showPrice ? "true" : undefined}
      onClick={() => onClick?.(row.card)}
    >
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
  m.quotes = {};
  m.priceRequests = [];
  window.localStorage.clear();
});

describe("CollectionTable selection", () => {
  it("selects a clicked row's card together with its copies and collection name", () => {
    const bolt = makeCard();
    renderTable([
      makePhysical("p1", bolt, { finish: "foil" }),
      makePhysical("p2", bolt, { finish: "foil" })
    ]);
    fireEvent.click(screen.getAllByTestId("collection-row")[0]);
    expect(m.setSelectedCard).toHaveBeenCalledWith(
      bolt,
      expect.objectContaining({
        cardId: "card-1",
        physicalCardIds: ["p1", "p2"],
        finish: "foil",
        condition: "NM",
        isProxy: false,
        locationName: "Main Collection"
      })
    );
  });
});

describe("CollectionTable price toggle", () => {
  const bolt = makeCard();
  const quoted = {
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

  it("is off by default: no price column, no value, and quotes are not requested", () => {
    renderTable([makePhysical("p1", bolt)]);
    expect(screen.queryByText("Price")).not.toBeInTheDocument();
    expect(screen.queryByTestId("collection-value")).not.toBeInTheDocument();
    expect(m.priceRequests.every((r) => !r.enabled)).toBe(true);
    expect(screen.getByLabelText("Show prices")).toHaveAttribute("aria-pressed", "false");
  });

  it("toggling on shows the price column, passes it to rows, and totals the rows' value", () => {
    m.quotes = { "card-1": quoted };
    renderTable([
      makePhysical("p1", bolt),
      makePhysical("p2", bolt),
      makePhysical("p3", bolt, { finish: "foil" })
    ]);
    fireEvent.click(screen.getByLabelText("Show prices"));

    expect(screen.getByText("Price")).toBeInTheDocument();
    expect(m.priceRequests.at(-1)).toEqual({ ids: ["card-1", "card-1"], enabled: true });
    expect(
      screen.getAllByTestId("collection-row").every((r) => r.dataset.showPrice === "true")
    ).toBe(true);
    // 2 × $1.50 non-foil + 1 × $4.00 foil, all estimated from the printing (no copy fetch yet)
    expect(screen.getByTestId("collection-value")).toHaveTextContent("$7.00");
    expect(screen.getByTestId("collection-value")).toHaveTextContent("(3 estimated)");
    expect(screen.getByTestId("collection-value")).not.toHaveTextContent("unpriced");
    expect(
      screen.getByTestId("collection-value").querySelector("[data-age-level]")
    ).toHaveAttribute("data-age-level", "stale");
  });

  it("counts copies without a price as unpriced and persists the toggle", () => {
    m.quotes = { "card-1": { ...quoted, prices: { ...quoted.prices, usd_foil: null } } };
    renderTable([makePhysical("p1", bolt), makePhysical("p2", bolt, { finish: "foil" })]);
    fireEvent.click(screen.getByLabelText("Show prices"));
    expect(screen.getByTestId("collection-value")).toHaveTextContent("$1.50");
    expect(screen.getByTestId("collection-value")).toHaveTextContent("(2 estimated, 1 unpriced)");
    expect(JSON.parse(window.localStorage.getItem("collection-show-prices")!)).toBe(true);
  });

  it("counts proxies at $0: not estimated, not unpriced", () => {
    m.quotes = { "card-1": quoted };
    renderTable([
      makePhysical("p1", bolt, { tags: ["Proxy"] }),
      makePhysical("p2", bolt, { tags: ["Proxy"] }),
      makePhysical("p3", bolt, {
        price: {
          usd: "1.50",
          finish: "nonfoil",
          condition: "NM",
          conditionMatched: true,
          updatedAt: new Date().toISOString()
        }
      })
    ]);
    fireEvent.click(screen.getByLabelText("Show prices"));
    const value = screen.getByTestId("collection-value");
    expect(value).toHaveTextContent("$1.50");
    expect(value).not.toHaveTextContent("estimated");
    expect(value).not.toHaveTextContent("unpriced");
    expect(value.querySelector("[data-age-level]")).toHaveAttribute("data-age-level", "fresh");
  });

  it("values copies at their own fetched price and marks the total fresh when nothing is estimated", () => {
    m.quotes = { "card-1": quoted };
    const priced = {
      usd: "0.90",
      finish: "nonfoil",
      condition: "LP",
      conditionMatched: true,
      updatedAt: new Date().toISOString()
    };
    renderTable([
      makePhysical("p1", bolt, { condition: "LP", price: priced }),
      makePhysical("p2", bolt, { condition: "LP", price: priced })
    ]);
    fireEvent.click(screen.getByLabelText("Show prices"));
    const value = screen.getByTestId("collection-value");
    expect(value).toHaveTextContent("$1.80");
    expect(value).not.toHaveTextContent("estimated");
    expect(value.querySelector("[data-age-level]")).toHaveAttribute("data-age-level", "fresh");
  });
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

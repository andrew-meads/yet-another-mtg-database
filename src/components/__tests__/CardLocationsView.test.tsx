import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import type { CardLocationsResponse } from "@/hooks/react-query/useCardLocations";
import type { MtgCard } from "@/types/MtgCard";
import type { PriceQuote } from "@/types/CardPrice";

const h = vi.hoisted(() => ({
  locationsData: null as CardLocationsResponse | null,
  isLoading: false,
  setSelectedCard: vi.fn(),
  quotes: {} as Record<string, PriceQuote>,
  requested: [] as string[][]
}));

vi.mock("@/hooks/react-query/useCardLocations", () => ({
  useCardLocations: () => ({ data: h.locationsData, isLoading: h.isLoading })
}));

vi.mock("@/context/CardSelectionContext", () => ({
  useCardSelection: () => ({
    selectedCard: null,
    setSelectedCard: h.setSelectedCard
  })
}));

vi.mock("@/components/SetSvg", () => ({
  SetSvg: ({ setCode, rarityCode }: { setCode: string; rarityCode?: string }) =>
    React.createElement("span", {
      "data-testid": "set-svg",
      "data-set": setCode,
      "data-rarity": rarityCode
    })
}));

vi.mock("@/hooks/react-query/useCardPriceQuotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/react-query/useCardPriceQuotes")>();
  return {
    ...actual,
    useCardPriceQuotes: (ids: string[]) => {
      h.requested.push(ids);
      return { quotes: h.quotes, isLoading: false, error: null };
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
vi.mock("@/components/pricing/RefreshPriceButton", () => ({
  default: (props: { cardId?: string; physicalCardIds?: string[] }) => (
    <button data-testid="refresh-price">{props.cardId ?? props.physicalCardIds?.join(",")}</button>
  )
}));

import CardLocationsView from "@/components/CardLocationsView";

const mockCard = {
  id: "card-1",
  name: "Lightning Bolt",
  set: "m21",
  set_name: "Core Set 2021",
  released_at: "2020-06-25"
} as unknown as MtgCard;

const mockCard2 = {
  id: "card-2",
  name: "Lightning Bolt",
  set: "lea",
  set_name: "Limited Edition Alpha",
  released_at: "1993-08-05"
} as unknown as MtgCard;

// Radix primitives need pointer-capture APIs jsdom doesn't ship.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  h.locationsData = null;
  h.isLoading = false;
  h.quotes = {};
  h.requested = [];
});

function renderView() {
  return render(<CardLocationsView cardName="Lightning Bolt" />);
}

/** Every location row, in DOM order. */
function rows() {
  return screen.getAllByTestId("card-location-row");
}

/** Location names of every row, in DOM order. */
function rowLabels() {
  return rows().map((row) => row.querySelector("span[title]")!.textContent);
}

function rowFor(name: string) {
  return screen.getByText(name).closest('[data-testid="card-location-row"]') as HTMLElement;
}

describe("CardLocationsView", () => {
  it("shows loading text while fetching", () => {
    h.isLoading = true;
    renderView();
    expect(screen.getByText("Loading locations...")).toBeInTheDocument();
  });

  it("shows empty state when there are no locations", () => {
    h.locationsData = { locations: [] };
    renderView();
    expect(screen.getByText(/don't own any copies/)).toBeInTheDocument();
  });

  it("renders a collection row with its set icon and code", () => {
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main Collection"
            }
          ]
        }
      ]
    };
    renderView();
    const row = rowFor("Main Collection");
    expect(row).toHaveAttribute("data-location-type", "collection");
    expect(within(row).getByTestId("set-svg")).toHaveAttribute("data-set", "m21");
    expect(row).toHaveTextContent("m21");
  });

  it("renders a deck row for cards assigned to a deck", () => {
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main Collection",
              deckId: "deck-1",
              deckName: "My Commander Deck"
            }
          ]
        }
      ]
    };
    renderView();
    expect(screen.getByText("Main Collection")).toBeInTheDocument();
    expect(rowFor("My Commander Deck")).toHaveAttribute("data-location-type", "deck");
  });

  it("shows 'N (M free)' on collection rows when some copies are in decks", () => {
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            { _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" },
            { _id: "pc-2", card: mockCard, collectionId: "coll-1", collectionName: "Main" },
            {
              _id: "pc-3",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              deckId: "deck-1",
              deckName: "My Deck"
            }
          ]
        }
      ]
    };
    renderView();
    expect(screen.getByText("3 (2 free)")).toBeInTheDocument();
    expect(within(rowFor("My Deck")).getByTestId("card-location-qty")).toHaveTextContent("1");
  });

  it("shows just 'N' on collection rows when all copies are free", () => {
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            { _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" },
            { _id: "pc-2", card: mockCard, collectionId: "coll-1", collectionName: "Main" }
          ]
        }
      ]
    };
    renderView();
    expect(screen.getByTestId("card-location-qty")).toHaveTextContent("2");
    expect(screen.queryByText(/free/)).not.toBeInTheDocument();
  });

  it("creates separate rows for copies with different notes", () => {
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              notes: "foil"
            },
            {
              _id: "pc-2",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              notes: "signed"
            }
          ]
        }
      ]
    };
    renderView();
    expect(screen.getByText("foil")).toBeInTheDocument();
    expect(screen.getByText("signed")).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(screen.getAllByTestId("card-location-qty").map((q) => q.textContent)).toEqual([
      "1",
      "1"
    ]);
  });

  it("creates separate rows for copies with different tags", () => {
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              tags: ["red"]
            },
            {
              _id: "pc-2",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              tags: ["blue"]
            }
          ]
        }
      ]
    };
    renderView();
    // Rows sort by tags, so "blue" lists before "red".
    const tags = screen.getAllByTestId("card-location-tag").map((t) => t.textContent);
    expect(tags).toEqual(["blue", "red"]);
    expect(rows()).toHaveLength(2);
  });

  it("groups copies with the same notes and tags into one row", () => {
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              notes: "foil",
              tags: ["red"]
            },
            {
              _id: "pc-2",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              notes: "foil",
              tags: ["red"]
            }
          ]
        }
      ]
    };
    renderView();
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("card-location-qty")).toHaveTextContent("2");
    expect(screen.getAllByTestId("card-location-tag")).toHaveLength(1);
  });

  it("groups copies with the same tags regardless of tag order", () => {
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              tags: ["a", "b"]
            },
            {
              _id: "pc-2",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              tags: ["b", "a"]
            }
          ]
        }
      ]
    };
    renderView();
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("card-location-qty")).toHaveTextContent("2");
  });

  it("shows different printing as a separate row (different card.id)", () => {
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            { _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" },
            { _id: "pc-2", card: mockCard2, collectionId: "coll-1", collectionName: "Main" }
          ]
        }
      ]
    };
    renderView();
    const icons = screen.getAllByTestId("set-svg");
    const setCodes = icons.map((el) => el.getAttribute("data-set"));
    expect(setCodes).toContain("m21");
    expect(setCodes).toContain("lea");
    // One quote request covering both printings.
    expect(h.requested.at(-1)).toEqual(["card-1", "card-2"]);
  });

  it("renders no placeholder text for plain copies with no notes or tags", () => {
    h.quotes = {
      "card-1": {
        prices: {
          usd: "1.00",
          usd_foil: null,
          usd_etched: null,
          eur: null,
          eur_foil: null,
          tix: null
        },
        updatedAt: new Date().toISOString()
      }
    };
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [{ _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" }]
        }
      ]
    };
    renderView();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-location-tag")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-attribute-badges")).not.toBeInTheDocument();
  });

  describe("row ordering & nesting", () => {
    it("orders printings within a collection by set release date, oldest first", () => {
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main Collection",
            cards: [
              // m21 (2020) listed before lea (1993) in the data
              { _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" },
              { _id: "pc-2", card: mockCard2, collectionId: "coll-1", collectionName: "Main" }
            ]
          }
        ]
      };
      renderView();
      const setCodes = screen.getAllByTestId("set-svg").map((el) => el.getAttribute("data-set"));
      expect(setCodes).toEqual(["lea", "m21"]);
    });

    it("shows deck rows directly under their collection, before other collections", () => {
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "First Collection",
            cards: [
              { _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "First" },
              {
                _id: "pc-2",
                card: mockCard,
                collectionId: "coll-1",
                collectionName: "First",
                deckId: "deck-1",
                deckName: "My Deck"
              }
            ]
          },
          {
            collectionId: "coll-2",
            collectionName: "Second Collection",
            cards: [
              { _id: "pc-3", card: mockCard, collectionId: "coll-2", collectionName: "Second" }
            ]
          }
        ]
      };
      renderView();
      expect(rowLabels()).toEqual(["First Collection", "My Deck", "Second Collection"]);
    });

    it("shows one deck row per owning collection when a deck spans collections", () => {
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "First Collection",
            cards: [
              {
                _id: "pc-1",
                card: mockCard,
                collectionId: "coll-1",
                collectionName: "First",
                deckId: "deck-1",
                deckName: "My Deck"
              }
            ]
          },
          {
            collectionId: "coll-2",
            collectionName: "Second Collection",
            cards: [
              {
                _id: "pc-2",
                card: mockCard,
                collectionId: "coll-2",
                collectionName: "Second",
                deckId: "deck-1",
                deckName: "My Deck"
              }
            ]
          }
        ]
      };
      renderView();
      expect(rowLabels()).toEqual(["First Collection", "My Deck", "Second Collection", "My Deck"]);
    });

    it("nests each deck row under the printing row its copies belong to", () => {
      // Two printings in one collection, every copy in a deck (split across two
      // decks): each deck row must follow its own printing's row, not sit in a
      // block at the end.
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main Collection",
            cards: [
              {
                _id: "pc-1",
                card: mockCard, // m21, 2020
                collectionId: "coll-1",
                collectionName: "Main",
                deckId: "deck-1",
                deckName: "Deck One"
              },
              {
                _id: "pc-2",
                card: mockCard2, // lea, 1993
                collectionId: "coll-1",
                collectionName: "Main",
                deckId: "deck-2",
                deckName: "Deck Two"
              }
            ]
          }
        ]
      };
      renderView();
      expect(rowLabels()).toEqual([
        "Main Collection", // lea printing (oldest first)
        "Deck Two",
        "Main Collection", // m21 printing
        "Deck One"
      ]);
      // Deck rows share their parent's printing, so only collection rows carry a set icon.
      const setCodes = screen.getAllByTestId("set-svg").map((el) => el.getAttribute("data-set"));
      expect(setCodes).toEqual(["lea", "m21"]);
    });

    it("indents deck rows under their collection", () => {
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main Collection",
            cards: [
              {
                _id: "pc-1",
                card: mockCard,
                collectionId: "coll-1",
                collectionName: "Main",
                deckId: "deck-1",
                deckName: "My Deck"
              }
            ]
          }
        ]
      };
      renderView();
      expect(rowFor("My Deck").className).toMatch(/ml-5/);
      expect(rowFor("Main Collection").className).not.toMatch(/ml-5/);
    });
  });

  describe("open button", () => {
    it("navigates to the collection without selecting the row", async () => {
      const user = userEvent.setup();
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main Collection",
            cards: [{ _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" }]
          }
        ]
      };
      renderView();
      const router = useRouter();
      await user.click(screen.getByRole("button", { name: "Open collection Main Collection" }));
      expect(router.push).toHaveBeenCalledWith("/my-cards/collections/coll-1");
      expect(h.setSelectedCard).not.toHaveBeenCalled();
    });

    it("navigates to the deck", async () => {
      const user = userEvent.setup();
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main Collection",
            cards: [
              {
                _id: "pc-1",
                card: mockCard,
                collectionId: "coll-1",
                collectionName: "Main",
                deckId: "deck-1",
                deckName: "My Deck"
              }
            ]
          }
        ]
      };
      renderView();
      const router = useRouter();
      await user.click(screen.getByRole("button", { name: "Open deck My Deck" }));
      expect(router.push).toHaveBeenCalledWith("/my-cards/decks/deck-1");
    });
  });

  describe("row selection", () => {
    const twoRowData: CardLocationsResponse = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            { _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" },
            {
              _id: "pc-2",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              deckId: "deck-1",
              deckName: "My Deck"
            }
          ]
        }
      ]
    };

    it("clicking a row highlights only that row", async () => {
      const user = userEvent.setup();
      h.locationsData = twoRowData;
      renderView();

      await user.click(screen.getByText("Main Collection"));
      expect(rowFor("Main Collection").className).toMatch(/bg-primary/);
      expect(rowFor("My Deck").className).not.toMatch(/bg-primary/);
    });

    it("clicking a different row moves the highlight", async () => {
      const user = userEvent.setup();
      h.locationsData = twoRowData;
      renderView();

      await user.click(screen.getByText("Main Collection"));
      await user.click(screen.getByText("My Deck"));

      expect(rowFor("Main Collection").className).not.toMatch(/bg-primary/);
      expect(rowFor("My Deck").className).toMatch(/bg-primary/);
    });

    it("two rows with the same card but different notes are highlighted independently", async () => {
      const user = userEvent.setup();
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main Collection",
            cards: [
              {
                _id: "pc-1",
                card: mockCard,
                collectionId: "coll-1",
                collectionName: "Main",
                notes: "foil"
              },
              {
                _id: "pc-2",
                card: mockCard,
                collectionId: "coll-1",
                collectionName: "Main",
                notes: "signed"
              }
            ]
          }
        ]
      };
      renderView();

      await user.click(screen.getByText("foil"));
      expect(rowFor("foil").className).toMatch(/bg-primary/);
      expect(rowFor("signed").className).not.toMatch(/bg-primary/);
    });

    it("selection clears when cardName prop changes", async () => {
      const user = userEvent.setup();
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main Collection",
            cards: [{ _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" }]
          }
        ]
      };
      const { rerender } = render(<CardLocationsView cardName="Lightning Bolt" />);
      await user.click(screen.getByText("Main Collection"));
      expect(rowFor("Main Collection").className).toMatch(/bg-primary/);

      rerender(<CardLocationsView cardName="Counterspell" />);
      // After cardName change the component shows the new data (still mocked to same data here),
      // but selectedKey was reset so no row should be highlighted.
      expect(rowFor("Main Collection").className).not.toMatch(/bg-primary/);
    });
  });
});

describe("CardLocationsView finish / condition", () => {
  it("keeps foil copies on their own row with a badge, after the plain copies", () => {
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              finish: "foil",
              condition: "LP"
            },
            { _id: "pc-2", card: mockCard, collectionId: "coll-1", collectionName: "Main" },
            {
              _id: "pc-3",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              finish: "nonfoil",
              condition: "NM"
            }
          ]
        }
      ]
    };
    renderView();
    const all = rows();
    expect(all).toHaveLength(2);
    expect(within(all[0]).getByTestId("card-location-qty")).toHaveTextContent("2");
    expect(all[0]).not.toHaveTextContent("Foil");
    expect(all[1]).toHaveTextContent("Foil");
    expect(all[1]).toHaveTextContent("LP");
  });

  it("selects the card together with the row's copies when a row is clicked", async () => {
    const user = userEvent.setup();
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              finish: "foil"
            },
            {
              _id: "pc-2",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              finish: "foil"
            }
          ]
        }
      ]
    };
    renderView();
    await user.click(screen.getByText("Main Collection"));
    expect(h.setSelectedCard).toHaveBeenCalledWith(
      mockCard,
      expect.objectContaining({
        cardId: "card-1",
        physicalCardIds: ["pc-1", "pc-2"],
        finish: "foil",
        condition: "NM",
        isProxy: false,
        locationName: "Main Collection"
      })
    );
  });
});

describe("CardLocationsView copy prices", () => {
  const HOUR = 3_600_000;
  const printingQuote: PriceQuote = {
    prices: {
      usd: "1.50",
      usd_foil: "4.00",
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null
    },
    updatedAt: new Date(Date.now() - 2 * HOUR).toISOString()
  };

  it("shows the copies' own price with a fresh dot and a refresh for those copies", () => {
    h.quotes = { "card-1": printingQuote };
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: ["pc-1", "pc-2"].map((_id) => ({
            _id,
            card: mockCard,
            collectionId: "coll-1",
            collectionName: "Main",
            price: {
              usd: "3.25",
              source: "manapool",
              finish: "nonfoil",
              condition: "NM",
              conditionMatched: true,
              updatedAt: new Date(Date.now() - HOUR).toISOString()
            }
          }))
        }
      ]
    };
    renderView();
    const price = screen.getByTestId("card-location-price");
    expect(price).toHaveAttribute("data-price-kind", "copy");
    expect(price).toHaveTextContent("$3.25");
    expect(price.querySelector("[data-age-level]")).toHaveAttribute("data-age-level", "fresh");
    expect(within(price).getByTestId("refresh-price")).toHaveTextContent("pc-1,pc-2");
  });

  it("falls back to the printing's finish price as a stale estimate when never priced", () => {
    h.quotes = { "card-1": printingQuote };
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              finish: "foil"
            }
          ]
        }
      ]
    };
    renderView();
    const price = screen.getByTestId("card-location-price");
    expect(price).toHaveAttribute("data-price-kind", "estimate");
    expect(price).toHaveTextContent("$4.00");
    expect(price.querySelector("[data-age-level]")).toHaveAttribute("data-age-level", "stale");
  });

  it("shows $0 for proxies with no age dot or refresh", () => {
    h.quotes = { "card-1": printingQuote };
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              tags: ["Proxy"]
            }
          ]
        }
      ]
    };
    renderView();
    const price = screen.getByTestId("card-location-price");
    expect(price).toHaveAttribute("data-price-kind", "proxy");
    expect(price).toHaveTextContent("$0.00");
    expect(price.querySelector("[data-age-level]")).toBeNull();
    expect(within(price).queryByTestId("refresh-price")).toBeNull();
  });

  it("prices collection rows only — deck rows share their parent's copies", () => {
    h.quotes = { "card-1": printingQuote };
    h.locationsData = {
      locations: [
        {
          collectionId: "coll-1",
          collectionName: "Main Collection",
          cards: [
            {
              _id: "pc-1",
              card: mockCard,
              collectionId: "coll-1",
              collectionName: "Main",
              deckId: "deck-1",
              deckName: "My Deck"
            }
          ]
        }
      ]
    };
    renderView();
    expect(screen.getAllByTestId("card-location-price")).toHaveLength(1);
    expect(within(rowFor("My Deck")).queryByTestId("card-location-price")).toBeNull();
  });
});

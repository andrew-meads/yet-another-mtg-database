import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import type { CardLocationsResponse } from "@/hooks/react-query/useCardLocations";
import type { MtgCard } from "@/types/MtgCard";

const h = vi.hoisted(() => ({
  locationsData: null as CardLocationsResponse | null,
  isLoading: false,
  setSelectedCard: vi.fn()
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
    React.createElement("span", { "data-testid": "set-svg", "data-set": setCode, "data-rarity": rarityCode })
}));

import CardLocationsView from "@/components/CardLocationsView";

const mockCard = {
  id: "card-1",
  name: "Lightning Bolt",
  set: "m21",
  set_name: "Core Set 2021"
} as unknown as MtgCard;

const mockCard2 = {
  id: "card-2",
  name: "Lightning Bolt",
  set: "lea",
  set_name: "Limited Edition Alpha"
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
});

function renderView() {
  return render(<CardLocationsView cardName="Lightning Bolt" />);
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
    expect(screen.getByText("No locations found")).toBeInTheDocument();
  });

  it("renders a collection row with Library icon label", () => {
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
    expect(screen.getByText("Main Collection")).toBeInTheDocument();
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
    expect(screen.getByText("My Commander Deck")).toBeInTheDocument();
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
    expect(screen.getByText("2")).toBeInTheDocument();
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
    // Two separate collection rows, each with qty 1
    const qtyCells = screen.getAllByText("1");
    expect(qtyCells.length).toBeGreaterThanOrEqual(2);
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
    expect(screen.getByText("red")).toBeInTheDocument();
    expect(screen.getByText("blue")).toBeInTheDocument();
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
    // One collection row with qty 2
    expect(screen.getByText("2")).toBeInTheDocument();
    // Only one "red" label
    expect(screen.getAllByText("red").length).toBe(1);
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
    // Both grouped into one row with qty 2
    expect(screen.getByText("2")).toBeInTheDocument();
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
  });

  it("double-clicking a collection row navigates to the collection", async () => {
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
    await user.dblClick(screen.getByText("Main Collection"));
    expect(router.push).toHaveBeenCalledWith("/my-cards/collections/coll-1");
  });

  it("double-clicking a deck row navigates to the deck", async () => {
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
    await user.dblClick(screen.getByText("My Deck"));
    expect(router.push).toHaveBeenCalledWith("/my-cards/decks/deck-1");
  });

  describe("totals summary", () => {
    it("shows total copies when all are free", () => {
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main",
            cards: [
              { _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" },
              { _id: "pc-2", card: mockCard, collectionId: "coll-1", collectionName: "Main" }
            ]
          }
        ]
      };
      renderView();
      expect(screen.getByText(/2 copies total/)).toBeInTheDocument();
      expect(screen.queryByText(/free/)).not.toBeInTheDocument();
    });

    it("shows total and free count when some copies are in decks", () => {
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main",
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
      const summary = screen.getByText(/3 copies total/);
      expect(summary).toBeInTheDocument();
      expect(summary.textContent).toContain("2 free");
    });

    it("uses singular 'copy' for a single card", () => {
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main",
            cards: [
              { _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" }
            ]
          }
        ]
      };
      renderView();
      expect(screen.getByText(/1 copy total/)).toBeInTheDocument();
    });
  });

  it("shows '—' for empty notes and tags", () => {
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
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2); // notes column + tags column
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

      const collRow = screen.getByText("Main Collection").closest("tr")!;
      const deckRow = screen.getByText("My Deck").closest("tr")!;

      await user.click(screen.getByText("Main Collection"));
      expect(collRow.className).toMatch(/bg-primary/);
      expect(deckRow.className).not.toMatch(/bg-primary/);
    });

    it("clicking a different row moves the highlight", async () => {
      const user = userEvent.setup();
      h.locationsData = twoRowData;
      renderView();

      const collRow = screen.getByText("Main Collection").closest("tr")!;
      const deckRow = screen.getByText("My Deck").closest("tr")!;

      await user.click(screen.getByText("Main Collection"));
      await user.click(screen.getByText("My Deck"));

      expect(collRow.className).not.toMatch(/bg-primary/);
      expect(deckRow.className).toMatch(/bg-primary/);
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

      const foilRow = screen.getByText("foil").closest("tr")!;
      const signedRow = screen.getByText("signed").closest("tr")!;

      await user.click(screen.getByText("foil"));
      expect(foilRow.className).toMatch(/bg-primary/);
      expect(signedRow.className).not.toMatch(/bg-primary/);
    });

    it("selection clears when cardName prop changes", async () => {
      const user = userEvent.setup();
      h.locationsData = {
        locations: [
          {
            collectionId: "coll-1",
            collectionName: "Main Collection",
            cards: [
              { _id: "pc-1", card: mockCard, collectionId: "coll-1", collectionName: "Main" }
            ]
          }
        ]
      };
      const { rerender } = render(<CardLocationsView cardName="Lightning Bolt" />);
      await user.click(screen.getByText("Main Collection"));
      const row = screen.getByText("Main Collection").closest("tr")!;
      expect(row.className).toMatch(/bg-primary/);

      rerender(<CardLocationsView cardName="Counterspell" />);
      // After cardName change the component shows the new data (still mocked to same data here),
      // but selectedKey was reset so no row should be highlighted.
      expect(row.className).not.toMatch(/bg-primary/);
    });
  });
});

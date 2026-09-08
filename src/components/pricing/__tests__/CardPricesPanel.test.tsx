import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import type { SlimMtgCard } from "@/types/MtgCard";
import type { PriceQuote } from "@/types/CardPrice";
import type { SelectedCopies } from "@/context/CardSelectionContext";
import type { CardLocationsResponse } from "@/hooks/react-query/useCardLocations";

const h = vi.hoisted(() => ({
  quotes: {} as Record<string, PriceQuote>,
  requested: [] as string[][],
  selectedCopies: null as SelectedCopies | null,
  locations: null as CardLocationsResponse | null
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
vi.mock("@/hooks/react-query/useCardLocations", () => ({
  useCardLocations: () => ({ data: h.locations, isLoading: false })
}));
vi.mock("@/context/CardSelectionContext", () => ({
  useCardSelection: () => ({
    selectedCard: null,
    selectedCopies: h.selectedCopies,
    setSelectedCard: vi.fn()
  })
}));
vi.mock("@/components/pricing/RefreshPriceButton", () => ({
  default: (props: { cardId?: string; physicalCardIds?: string[] }) => (
    <button data-testid="refresh-price">{props.cardId ?? props.physicalCardIds?.join(",")}</button>
  )
}));
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    currency: "USD",
    configured: "USD",
    rate: 1,
    loading: false,
    format: (usd: number | null) => (usd === null ? null : `$${usd.toFixed(2)}`)
  })
}));

import CardPricesPanel from "@/components/pricing/CardPricesPanel";

const card = { id: "card-1", name: "Lightning Bolt" } as SlimMtgCard;
const HOUR = 3_600_000;
const printingQuote: PriceQuote = {
  prices: { usd: "1.50", usd_foil: "4.00", usd_etched: null, eur: null, eur_foil: null, tix: null },
  updatedAt: new Date(Date.now() - 2 * HOUR).toISOString()
};

beforeEach(() => {
  h.quotes = {};
  h.requested = [];
  h.selectedCopies = null;
  h.locations = null;
});

describe("CardPricesPanel (printing)", () => {
  it("lists one line per quoted finish and the quote's age", () => {
    h.quotes = { "card-1": printingQuote };
    render(<CardPricesPanel card={card} />);
    expect(h.requested[0]).toEqual(["card-1"]);
    expect(screen.getByText("Prices")).toBeInTheDocument();
    expect(screen.queryByTestId("your-copies")).not.toBeInTheDocument();
    expect(screen.getByText("Non-foil")).toBeInTheDocument();
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(screen.getByText("Foil")).toBeInTheDocument();
    expect(screen.getByText("$4.00")).toBeInTheDocument();
    expect(screen.queryByText("Etched foil")).not.toBeInTheDocument();
    expect(screen.getByText(/updated 2 hours ago/)).toBeInTheDocument();
    expect(screen.getByTestId("refresh-price")).toHaveTextContent("card-1");
    expect(screen.getByTestId("card-prices-source")).toHaveTextContent("Scryfall prices in USD");
  });

  it("names the source the prices came from", () => {
    h.quotes = {
      "card-1": {
        prices: { ...printingQuote.prices, source: "manapool" },
        updatedAt: new Date().toISOString()
      }
    };
    render(<CardPricesPanel card={card} />);
    expect(screen.getByTestId("card-prices-source")).toHaveTextContent("Mana Pool prices in USD");
  });

  it("falls back to the prices carried on the card while no quote is loaded", () => {
    render(
      <CardPricesPanel
        card={{
          ...card,
          prices: {
            usd: "0.25",
            usd_foil: null,
            usd_etched: null,
            eur: null,
            eur_foil: null,
            tix: null
          },
          prices_updated_at: new Date(Date.now() - 40 * 24 * HOUR).toISOString()
        }}
      />
    );
    expect(screen.getByText("$0.25")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("data-age-level", "stale");
  });

  it("says so when there is no price at all", () => {
    render(<CardPricesPanel card={card} />);
    expect(screen.getByText(/No price available for this printing/)).toBeInTheDocument();
    expect(screen.getByText("never fetched")).toBeInTheDocument();
  });
});

describe("CardPricesPanel (selected copies)", () => {
  const selection: SelectedCopies = {
    cardId: "card-1",
    physicalCardIds: ["p1", "p2"],
    finish: "foil",
    condition: "LP",
    isProxy: false,
    locationName: "Main Collection"
  };

  it("shows the copies' own price with its age, source and a refresh for those copies", () => {
    h.quotes = { "card-1": printingQuote };
    h.selectedCopies = {
      ...selection,
      copyPrice: {
        usd: 3.5,
        source: "manapool",
        conditionMatched: true,
        updatedAt: new Date(Date.now() - HOUR).toISOString()
      }
    };
    render(<CardPricesPanel card={card} />);
    const block = screen.getByTestId("your-copies");
    expect(block).toHaveAttribute("data-price-kind", "copy");
    expect(block).toHaveTextContent("Your 2 copies");
    expect(block).toHaveTextContent("in Main Collection");
    expect(block).toHaveTextContent("Foil · LP (Lightly Played)");
    expect(screen.getByTestId("your-copies-price")).toHaveTextContent("2 × $3.50 = $7.00");
    expect(screen.getByTestId("your-copies-detail")).toHaveTextContent(
      "Mana Pool price for foil, LP (Lightly Played), in USD"
    );
    expect(block.querySelector("[data-age-level]")).toHaveAttribute("data-age-level", "fresh");
    expect(block).toHaveTextContent("updated 1 hour ago");
    expect(block.querySelector('[data-testid="refresh-price"]')).toHaveTextContent("p1,p2");
    // The printing block follows, re-titled.
    expect(screen.getByText("This printing")).toBeInTheDocument();
  });

  it("shows the printing's finish price as a stale estimate when the copies were never priced", () => {
    h.quotes = { "card-1": printingQuote };
    h.selectedCopies = selection;
    render(<CardPricesPanel card={card} />);
    const block = screen.getByTestId("your-copies");
    expect(block).toHaveAttribute("data-price-kind", "estimate");
    expect(screen.getByTestId("your-copies-price")).toHaveTextContent("2 × $4.00 = $8.00");
    expect(block.querySelector("[data-age-level]")).toHaveAttribute("data-age-level", "stale");
    expect(block).toHaveTextContent("estimated");
    expect(screen.getByTestId("your-copies-detail")).toHaveTextContent("not yet priced for LP");
  });

  it("shows $0 for a proxy with no age or refresh", () => {
    h.selectedCopies = { ...selection, physicalCardIds: ["p1"], isProxy: true };
    render(<CardPricesPanel card={card} />);
    const block = screen.getByTestId("your-copies");
    expect(block).toHaveAttribute("data-price-kind", "proxy");
    expect(block).toHaveTextContent("Your copy");
    expect(screen.getByTestId("your-copies-price")).toHaveTextContent("$0.00");
    expect(block.querySelector("[data-age-level]")).toBeNull();
    expect(block.querySelector('[data-testid="refresh-price"]')).toBeNull();
  });

  it("prefers the live copy records from card locations over the click-time snapshot", () => {
    h.quotes = { "card-1": printingQuote };
    h.selectedCopies = selection; // snapshot: never priced
    h.locations = {
      locations: [
        {
          collectionId: "c1",
          collectionName: "Main Collection",
          cards: ["p1", "p2"].map((_id) => ({
            _id,
            card,
            collectionId: "c1",
            finish: "foil",
            condition: "LP",
            price: {
              usd: "3.25",
              source: "manapool",
              finish: "foil",
              condition: "LP",
              conditionMatched: true,
              updatedAt: new Date().toISOString()
            }
          }))
        }
      ]
    };
    render(<CardPricesPanel card={card} />);
    expect(screen.getByTestId("your-copies")).toHaveAttribute("data-price-kind", "copy");
    expect(screen.getByTestId("your-copies-price")).toHaveTextContent("2 × $3.25 = $6.50");
  });

  it("ignores copies that belong to another printing", () => {
    h.selectedCopies = { ...selection, cardId: "other" };
    render(<CardPricesPanel card={card} />);
    expect(screen.queryByTestId("your-copies")).not.toBeInTheDocument();
    expect(screen.getByText("Prices")).toBeInTheDocument();
  });
});

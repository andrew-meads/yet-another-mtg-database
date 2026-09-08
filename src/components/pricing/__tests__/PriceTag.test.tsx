import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import PriceTag from "@/components/pricing/PriceTag";

vi.mock("@/components/pricing/RefreshPriceButton", () => ({
  default: ({ cardId }: { cardId: string }) => <button data-testid="refresh-price">{cardId}</button>
}));
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    currency: "NZD",
    configured: "NZD",
    rate: 2,
    loading: false,
    format: (usd: number | null) => (usd === null ? null : `NZ$${(usd * 2).toFixed(2)}`)
  })
}));

const prices = {
  usd: "1.50",
  usd_foil: "4.00",
  usd_etched: null,
  eur: null,
  eur_foil: null,
  tix: null
};

describe("PriceTag", () => {
  it("shows the printing's best price in the user's currency with an age dot", () => {
    render(<PriceTag prices={prices} updatedAt={new Date()} />);
    expect(screen.getByTestId("price-tag")).toHaveTextContent("NZ$3.00");
    expect(screen.getByRole("img")).toHaveAttribute("data-age-level", "fresh");
  });

  it("prices a specific finish, multiplied by quantity", () => {
    render(<PriceTag prices={prices} finish="foil" quantity={3} />);
    expect(screen.getByTestId("price-tag")).toHaveTextContent("NZ$24.00");
  });

  it("shows a dash when the requested finish has no price", () => {
    render(<PriceTag prices={prices} finish="etched" />);
    expect(screen.getByTestId("price-tag")).toHaveTextContent("—");
    expect(screen.getByRole("img")).toHaveAttribute("data-age-level", "unknown");
  });

  it("shows a dash with no price data at all", () => {
    render(<PriceTag />);
    expect(screen.getByTestId("price-tag")).toHaveTextContent("—");
  });

  it("renders the refresh icon only when given a card id", () => {
    render(<PriceTag prices={prices} cardId="card-1" />);
    expect(screen.getByTestId("refresh-price")).toHaveTextContent("card-1");
    render(<PriceTag prices={prices} />);
    expect(screen.getAllByTestId("refresh-price")).toHaveLength(1);
  });
});

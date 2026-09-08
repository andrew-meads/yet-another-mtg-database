import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PriceQuote } from "@/types/CardPrice";

const h = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: h.toastError } }));

import RefreshPriceButton from "@/components/pricing/RefreshPriceButton";

const prices = {
  usd: "9.99",
  usd_foil: null,
  usd_etched: null,
  eur: null,
  eur_foil: null,
  tix: null
};
let fetchMock: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => h.toastError.mockClear());
afterEach(() => fetchMock?.mockRestore());

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return qc;
}

describe("RefreshPriceButton", () => {
  it("posts the card id to the refresh route and merges the quote into cached price queries", async () => {
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ prices: { a: prices }, updatedAt: { a: "2026-09-08T00:00:00.000Z" } })
      );
    const qc = renderWithClient(<RefreshPriceButton cardId="a" />);
    qc.setQueryData<Record<string, PriceQuote>>(["card-prices", ["a", "b"]], {
      a: { prices: { ...prices, usd: "1.00" }, updatedAt: null },
      b: { prices, updatedAt: null }
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh price" }));

    await waitFor(() =>
      expect(qc.getQueryData<Record<string, PriceQuote>>(["card-prices", ["a", "b"]])?.a).toEqual({
        prices,
        updatedAt: "2026-09-08T00:00:00.000Z"
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cards/prices/refresh",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: ["a"] }) })
    );
    // Untouched entries survive the merge.
    expect(qc.getQueryData<Record<string, PriceQuote>>(["card-prices", ["a", "b"]])?.b).toEqual({
      prices,
      updatedAt: null
    });
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("does not let the click bubble to the row", () => {
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ prices: {}, updatedAt: {} }));
    const onRowClick = vi.fn();
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <div onClick={onRowClick}>
          <RefreshPriceButton cardId="a" />
        </div>
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh price" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("toasts when the refresh fails", async () => {
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ error: "Scryfall is down" }, { status: 502 }));
    renderWithClient(<RefreshPriceButton cardId="a" />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh price" }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("Couldn't refresh price: Scryfall is down")
    );
  });

  it("refreshes copies through the physical-cards route and invalidates the details", async () => {
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ prices: {}, unknown: [] }));
    const qc = renderWithClient(<RefreshPriceButton physicalCardIds={["p1", "p2"]} />);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: "Refresh price" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/physical-cards/prices/refresh",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ physicalCardIds: ["p1", "p2"] })
        })
      )
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["collection-details"] })
      )
    );
  });
});

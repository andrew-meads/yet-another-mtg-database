import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  currency: "USD",
  sources: undefined as undefined | Array<{ id: string; enabled: boolean }>,
  setPricing: vi.fn()
}));

vi.mock("@/context/SettingsContext", () => ({
  usePricingSettings: () => ({
    pricing: { currency: h.currency, sources: h.sources },
    setPricing: h.setPricing
  })
}));

import PricingSettingsSection from "@/components/settings/PricingSettingsSection";

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  h.currency = "USD";
  h.sources = undefined;
  h.setPricing.mockClear();
});

describe("PricingSettingsSection price sources", () => {
  it("lists every source in default order with edge moves disabled", () => {
    render(<PricingSettingsSection />);
    const rows = screen.getAllByTestId(/^price-source-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      "price-source-scryfall",
      "price-source-tcgplayer",
      "price-source-manapool"
    ]);
    expect(rows.every((r) => r.dataset.enabled === "true")).toBe(true);
    expect(screen.getByRole("button", { name: "Move Scryfall up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Mana Pool down" })).toBeDisabled();
  });

  it("reflects a stored order and persists a move", async () => {
    h.sources = [
      { id: "tcgplayer", enabled: true },
      { id: "scryfall", enabled: false }
    ];
    const user = userEvent.setup();
    render(<PricingSettingsSection />);
    const rows = screen.getAllByTestId(/^price-source-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      "price-source-tcgplayer",
      "price-source-scryfall",
      "price-source-manapool" // appended by normalization
    ]);
    expect(screen.getByTestId("price-source-scryfall").dataset.enabled).toBe("false");

    await user.click(screen.getByRole("button", { name: "Move Scryfall up" }));
    expect(h.setPricing).toHaveBeenCalledWith({
      sources: [
        { id: "scryfall", enabled: false },
        { id: "tcgplayer", enabled: true },
        { id: "manapool", enabled: true }
      ]
    });
  });

  it("persists enabling/disabling a source", async () => {
    const user = userEvent.setup();
    render(<PricingSettingsSection />);
    await user.click(screen.getByRole("switch", { name: "Use Mana Pool" }));
    expect(h.setPricing).toHaveBeenCalledWith({
      sources: [
        { id: "scryfall", enabled: true },
        { id: "tcgplayer", enabled: true },
        { id: "manapool", enabled: false }
      ]
    });
  });
});

describe("PricingSettingsSection", () => {
  it("shows the configured currency", () => {
    h.currency = "NZD";
    render(<PricingSettingsSection />);
    expect(screen.getByRole("combobox", { name: "Display currency" })).toHaveTextContent("NZD");
  });

  it("persists a new currency choice immediately", async () => {
    const user = userEvent.setup();
    render(<PricingSettingsSection />);
    await user.click(screen.getByRole("combobox", { name: "Display currency" }));
    await user.click(await screen.findByRole("option", { name: /EUR — Euro/ }));
    expect(h.setPricing).toHaveBeenCalledWith({ currency: "EUR" });
  });
});

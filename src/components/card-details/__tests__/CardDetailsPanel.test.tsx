import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CardLocationsResponse } from "@/hooks/react-query/useCardLocations";
import type { SlimMtgCard } from "@/types/MtgCard";

const h = vi.hoisted(() => ({
  locations: null as CardLocationsResponse | null,
  locationsLoading: false
}));

vi.mock("@/hooks/react-query/useCardLocations", () => ({
  useCardLocations: () => ({ data: h.locations, isLoading: h.locationsLoading })
}));
vi.mock("@/components/CardArtView", () => ({
  default: ({ card }: { card: SlimMtgCard }) => <div data-testid="card-art">{card.name}</div>
}));
vi.mock("@/components/CardLocationsView", () => ({
  default: ({ cardName }: { cardName: string }) => (
    <div data-testid="locations-view">locations of {cardName}</div>
  )
}));
vi.mock("@/components/pricing/CardPricesPanel", () => ({
  default: ({ card }: { card: SlimMtgCard }) => (
    <div data-testid="prices-panel">prices of {card.name}</div>
  )
}));

import CardDetailsPanel, {
  CARD_PANEL_TAB_KEY,
  CardDetailsTabs
} from "@/components/card-details/CardDetailsPanel";

const card = {
  id: "card-1",
  name: "Lightning Bolt",
  type_line: "Instant",
  oracle_text: "Lightning Bolt deals 3 damage to any target.",
  mana_cost: "{R}"
} as SlimMtgCard;

// Radix primitives need pointer-capture APIs jsdom doesn't ship.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  h.locations = null;
  h.locationsLoading = false;
  window.localStorage.clear();
});

describe("CardDetailsTabs", () => {
  it("opens on the Text tab with the rules text visible and the other tabs unmounted", () => {
    render(<CardDetailsTabs card={card} fill />);
    expect(screen.getByRole("tab", { name: "Text" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Lightning Bolt deals 3 damage to any target.")).toBeInTheDocument();
    expect(screen.queryByTestId("locations-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prices-panel")).not.toBeInTheDocument();
  });

  it("switches tabs and remembers the last one in localStorage", async () => {
    const user = userEvent.setup();
    render(<CardDetailsTabs card={card} fill />);

    await user.click(screen.getByRole("tab", { name: /Copies/ }));
    expect(screen.getByTestId("locations-view")).toHaveTextContent("locations of Lightning Bolt");
    expect(JSON.parse(window.localStorage.getItem(CARD_PANEL_TAB_KEY)!)).toBe("copies");

    await user.click(screen.getByRole("tab", { name: "Prices" }));
    expect(screen.getByTestId("prices-panel")).toHaveTextContent("prices of Lightning Bolt");
    expect(JSON.parse(window.localStorage.getItem(CARD_PANEL_TAB_KEY)!)).toBe("prices");
  });

  it("restores the remembered tab on mount", () => {
    window.localStorage.setItem(CARD_PANEL_TAB_KEY, JSON.stringify("prices"));
    render(<CardDetailsTabs card={card} fill />);
    expect(screen.getByRole("tab", { name: "Prices" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("prices-panel")).toBeInTheDocument();
  });

  it("ignores an unknown remembered tab", () => {
    window.localStorage.setItem(CARD_PANEL_TAB_KEY, JSON.stringify("rulings"));
    render(<CardDetailsTabs card={card} fill />);
    expect(screen.getByRole("tab", { name: "Text" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the owned-copy count on the Copies tab, and nothing when unowned", () => {
    const { rerender } = render(<CardDetailsTabs card={card} fill />);
    expect(screen.queryByTestId("copies-tab-count")).not.toBeInTheDocument();

    h.locations = {
      locations: [
        {
          collectionId: "c1",
          collectionName: "Main",
          cards: [
            { _id: "p1", card, collectionId: "c1" },
            { _id: "p2", card, collectionId: "c1", deckId: "d1", deckName: "Deck" }
          ]
        },
        {
          collectionId: "c2",
          collectionName: "Binder",
          cards: [{ _id: "p3", card, collectionId: "c2" }]
        }
      ]
    };
    rerender(<CardDetailsTabs card={{ ...card }} fill />);
    expect(screen.getByTestId("copies-tab-count")).toHaveTextContent("3");
  });

  it("holds a placeholder pill in the badge's place while the copies are loading", () => {
    h.locationsLoading = true;
    const { rerender } = render(<CardDetailsTabs card={card} fill />);
    expect(screen.getByTestId("copies-tab-count-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("copies-tab-count")).not.toBeInTheDocument();

    // Fetch resolves: the pill gives way to the real count...
    h.locationsLoading = false;
    h.locations = {
      locations: [
        {
          collectionId: "c1",
          collectionName: "Main",
          cards: [{ _id: "p1", card, collectionId: "c1" }]
        }
      ]
    };
    rerender(<CardDetailsTabs card={{ ...card }} fill />);
    expect(screen.queryByTestId("copies-tab-count-pending")).not.toBeInTheDocument();
    expect(screen.getByTestId("copies-tab-count")).toHaveTextContent("1");

    // ...and switching to a card whose copies are still loading brings the pill back
    // instead of briefly dropping the badge.
    h.locationsLoading = true;
    h.locations = null;
    rerender(<CardDetailsTabs card={{ ...card, name: "Grizzly Bears" }} fill />);
    expect(screen.getByTestId("copies-tab-count-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("copies-tab-count")).not.toBeInTheDocument();
  });
});

describe("CardDetailsPanel", () => {
  it("stacks the image above the tabs in the mobile layout", () => {
    render(<CardDetailsPanel card={card} layout="stack" />);
    const art = screen.getByTestId("card-art");
    const tabs = screen.getByTestId("card-details-tabs");
    expect(art.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Lightning Bolt deals 3 damage to any target.")).toBeInTheDocument();
  });

  it("splits the image pane from the tabs in the desktop layout", () => {
    render(<CardDetailsPanel card={card} layout="split" />);
    expect(screen.getByTestId("card-image-pane")).toContainElement(screen.getByTestId("card-art"));
    expect(screen.getByTestId("card-details-tabs")).toBeInTheDocument();
  });
});

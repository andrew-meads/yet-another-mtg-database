import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { SlimMtgCard } from "@/types/MtgCard";

const h = vi.hoisted(() => ({ selectedCard: null as SlimMtgCard | null }));

vi.mock("@/context/CardSelectionContext", () => ({
  useCardSelection: () => ({
    selectedCard: h.selectedCard,
    selectedCopies: null,
    setSelectedCard: vi.fn()
  })
}));
vi.mock("@/components/card-details/CardDetailsPanel", () => ({
  default: ({ card, layout }: { card: SlimMtgCard; layout: string }) => (
    <div data-testid="card-details-panel" data-layout={layout}>
      {card.name}
    </div>
  )
}));

import SelectedCardPage from "@/app/selected-card/page";

const card = { id: "card-1", name: "Lightning Bolt" } as SlimMtgCard;

describe("SelectedCardPage", () => {
  it("renders a blank frame on the server, whatever the (localStorage-held) selection is", () => {
    h.selectedCard = card;
    const html = renderToString(<SelectedCardPage />);
    expect(html).toContain("selected-card-hydrating");
    expect(html).not.toContain("Lightning Bolt");
    expect(html).not.toContain("No Card Selected");
  });

  it("shows the selected card in the stacked details panel once mounted", () => {
    h.selectedCard = card;
    render(<SelectedCardPage />);
    expect(screen.queryByTestId("selected-card-hydrating")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lightning Bolt" })).toBeInTheDocument();
    expect(screen.getByTestId("card-details-panel")).toHaveAttribute("data-layout", "stack");
  });

  it("shows the empty state once mounted with nothing selected", () => {
    h.selectedCard = null;
    render(<SelectedCardPage />);
    expect(screen.getByText("No Card Selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go Back/ })).toBeInTheDocument();
  });
});

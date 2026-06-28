import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  addColumn: vi.fn(),
  createCard: vi.fn(),
  lands: [
    { id: "unh-plains", name: "Plains" },
    { id: "unh-island", name: "Island" },
    { id: "unh-swamp", name: "Swamp" },
    { id: "unh-mountain", name: "Mountain" },
    { id: "unh-forest", name: "Forest" }
  ]
}));

// Render the popover inline so its content is always present (no portal/pointer deps).
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  PopoverContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children)
}));

vi.mock("@/components/CardArtView", () => ({
  SimpleCardArtView: () => React.createElement("div", { "data-testid": "card-art" })
}));

vi.mock("@/hooks/react-query/useBasicLands", () => ({
  useBasicLands: () => ({ data: { cards: h.lands }, isLoading: false, isError: false })
}));
vi.mock("@/hooks/react-query/useDeckColumns", () => ({
  useAddColumn: () => ({ mutateAsync: h.addColumn })
}));
vi.mock("@/hooks/react-query/useCreatePhysicalCard", () => ({
  useCreatePhysicalCard: () => ({ mutateAsync: h.createCard })
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AddBasicLandButton from "@/components/my-cards-page/deck-view/AddBasicLandButton";

beforeEach(() => {
  vi.clearAllMocks();
  h.addColumn.mockResolvedValue({ columnId: "new-col" });
  h.createCard.mockResolvedValue({ physicalCardIds: ["x"] });
});

describe("AddBasicLandButton", () => {
  it("renders all five basic lands", () => {
    render(React.createElement(AddBasicLandButton, { deckId: "d1", sectionId: "s1" }));
    for (const name of ["Plains", "Island", "Swamp", "Mountain", "Forest"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("adds the chosen quantity as ephemeral cards (no collectionId) in a new column", async () => {
    const user = userEvent.setup();
    render(React.createElement(AddBasicLandButton, { deckId: "d1", sectionId: "s1" }));

    // Bump Forest to 2.
    await user.click(screen.getByLabelText("Increase Forest"));
    await user.click(screen.getByLabelText("Increase Forest"));
    await user.click(screen.getByTestId("add-land-confirm"));

    await waitFor(() => expect(h.createCard).toHaveBeenCalledTimes(1));
    expect(h.addColumn).toHaveBeenCalledWith({ deckId: "d1", sectionId: "s1" });
    expect(h.createCard).toHaveBeenCalledWith({
      cardId: "unh-forest",
      deckId: "d1",
      sectionId: "s1",
      columnId: "new-col",
      quantity: 2
    });
    // Crucially, no collectionId is sent — these are ephemeral.
    expect(h.createCard.mock.calls[0][0]).not.toHaveProperty("collectionId");
  });

  it("the Add button is disabled until a quantity is chosen", () => {
    render(React.createElement(AddBasicLandButton, { deckId: "d1", sectionId: "s1" }));
    expect(screen.getByTestId("add-land-confirm")).toBeDisabled();
  });
});

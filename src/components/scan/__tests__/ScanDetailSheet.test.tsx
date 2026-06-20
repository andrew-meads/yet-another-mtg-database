import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sheet } from "@/components/ui/sheet";
import ScanDetailSheet from "@/components/scan/ScanDetailSheet";
import { server } from "../../../../tests/msw/server";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Serve a stub set icon so <SetSvg> renders its icon instead of the error state.
const SET_ICON_HANDLER = http.get("/api/sets/:code/svg", () =>
  HttpResponse.text('<svg data-testid="set-icon"><path /></svg>', {
    headers: { "Content-Type": "image/svg+xml" }
  })
);

// Capture the create-physical-card POST body so tests can assert on it.
let createdBody: any = null;
const CREATE_CARD_HANDLER = http.post("/api/physical-cards", async ({ request }) => {
  createdBody = await request.json();
  return HttpResponse.json({ physicalCardIds: ["x"] }, { status: 201 });
});

const twoMatches = {
  id: "scan_0",
  url: "/cards/crop-1.jpg",
  width: 488,
  height: 680,
  matches: [
    {
      id: "alpha-id",
      name: "Alpha",
      set: "lea",
      set_name: "Limited Edition Alpha",
      rarity: "rare",
      collector_number: "1"
    },
    {
      id: "beta-id",
      name: "Beta",
      set: "leb",
      set_name: "Limited Edition Beta",
      rarity: "mythic",
      collector_number: "2"
    }
  ]
};

const handlers = {
  onSelect: vi.fn(),
  onQuantity: vi.fn(),
  onAdded: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn()
};

function renderSheet(props: Partial<React.ComponentProps<typeof ScanDetailSheet>> = {}) {
  const client = new QueryClient();
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        Sheet,
        { open: true },
        React.createElement(ScanDetailSheet, {
          card: twoMatches as any,
          activeCollection: { _id: "coll-1", name: "Main" } as any,
          current: 1,
          total: 3,
          selectedIndex: 0,
          quantity: 1,
          addedCount: 0,
          hasPrev: false,
          hasNext: true,
          ...handlers,
          ...props
        })
      )
    )
  );
}

beforeEach(() => {
  createdBody = null;
  Object.values(handlers).forEach((fn) => fn.mockClear());
  server.use(SET_ICON_HANDLER, CREATE_CARD_HANDLER);
});
afterEach(() => {
  createdBody = null;
});

describe("ScanDetailSheet", () => {
  it("shows an empty state when there are no candidate matches", () => {
    renderSheet({
      card: { id: "scan_x", url: "/cards/c.jpg", width: 1, height: 1, matches: [] } as any
    });
    expect(screen.getByText(/no matches found/i)).toBeInTheDocument();
  });

  it("disables Add and explains why when there is no active collection", () => {
    renderSheet({ activeCollection: null });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByText(/no active collection/i)).toBeInTheDocument();
  });

  it("calls onSelect when a different candidate is tapped", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByTitle(/Beta/));
    expect(handlers.onSelect).toHaveBeenCalledWith(1);
  });

  it("renders a set icon for each candidate", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getAllByTestId("set-icon").length).toBeGreaterThanOrEqual(2));
  });

  it("adds the selected printing with the given quantity and reports it", async () => {
    const user = userEvent.setup();
    renderSheet({ selectedIndex: 1, quantity: 2 });
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody).toEqual({ cardId: "beta-id", collectionId: "coll-1", quantity: 2 });
    await waitFor(() => expect(handlers.onAdded).toHaveBeenCalled());
  });

  it("disables decrease at the minimum quantity and steps via onQuantity", async () => {
    const user = userEvent.setup();
    renderSheet({ quantity: 1 });
    expect(screen.getByLabelText("Decrease quantity")).toBeDisabled();
    await user.click(screen.getByLabelText("Increase quantity"));
    expect(handlers.onQuantity).toHaveBeenCalledWith(2);
  });

  it("opens an enlarged crop when the thumbnail is tapped", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.queryByAltText(/enlarged/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /view scanned card crop/i }));
    expect(await screen.findByAltText(/enlarged/i)).toBeInTheDocument();
  });

  it("pages with Prev/Next (Prev disabled at the start)", async () => {
    const user = userEvent.setup();
    renderSheet({ current: 1, total: 3, hasPrev: false, hasNext: true });
    expect(screen.getByText("Card 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous card/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /next card/i }));
    expect(handlers.onNext).toHaveBeenCalled();
  });
});

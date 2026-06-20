import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ScannedCardTile from "@/components/scan/ScannedCardTile";
import { defaultCardUiState } from "@/components/scan/scanShared";
import { server } from "../../../../tests/msw/server";

function renderTile(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(React.createElement(QueryClientProvider, { client }, ui));
}

const SET_ICON_HANDLER = http.get("/api/sets/:code/svg", () =>
  HttpResponse.text('<svg data-testid="set-icon"><path /></svg>', {
    headers: { "Content-Type": "image/svg+xml" }
  })
);

const card = {
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
    }
  ]
};

beforeEach(() => server.use(SET_ICON_HANDLER));

describe("ScannedCardTile", () => {
  it("shows the best guess prefixed with 'Likely:' before anything is added", () => {
    renderTile(<ScannedCardTile card={card as any} state={defaultCardUiState} onOpen={() => {}} />);
    expect(screen.getByText(/Likely:/)).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText(/Tap to choose/)).toBeInTheDocument();
  });

  it("fires onOpen when tapped", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderTile(<ScannedCardTile card={card as any} state={defaultCardUiState} onOpen={onOpen} />);
    await user.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("drops the 'Likely:' prefix and shows an Added badge once added", () => {
    renderTile(
      <ScannedCardTile
        card={card as any}
        state={{ selectedIndex: 0, quantity: 1, addedCount: 2 }}
        onOpen={() => {}}
      />
    );
    expect(screen.queryByText(/Likely:/)).not.toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText(/Added ×2/)).toBeInTheDocument();
  });

  it("shows 'No match' when there are no candidates", () => {
    renderTile(
      <ScannedCardTile
        card={{ ...card, matches: [] } as any}
        state={defaultCardUiState}
        onOpen={() => {}}
      />
    );
    expect(screen.getByText(/No match/)).toBeInTheDocument();
  });
});

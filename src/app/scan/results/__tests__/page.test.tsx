import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ScanResultsPage from "@/app/scan/results/page";
import { server } from "../../../../../tests/msw/server";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mocks = vi.hoisted(() => ({ scanResult: null as any, activeCollection: null as any }));
vi.mock("@/context/ScanContext", () => ({
  useScanContext: () => ({ scanResult: mocks.scanResult, setScanResult: () => {} })
}));
vi.mock("@/context/OpenEntitiesContext", () => ({
  useOpenEntitiesContext: () => ({ activeCollection: mocks.activeCollection })
}));

const SET_ICON_HANDLER = http.get("/api/sets/:code/svg", () =>
  HttpResponse.text("<svg><path /></svg>", { headers: { "Content-Type": "image/svg+xml" } })
);
const CREATE_CARD_HANDLER = http.post("/api/physical-cards", () =>
  HttpResponse.json({ physicalCardIds: ["x"] }, { status: 201 })
);

function match(id: string, name: string, set: string) {
  return { id, name, set, set_name: `${set} set`, rarity: "rare", collector_number: "1" };
}

const scanResult = {
  count: 2,
  debugUrl: null,
  cards: [
    {
      id: "scan_0",
      url: "/cards/scan_0.jpg",
      width: 488,
      height: 680,
      matches: [match("alpha-id", "Alpha", "lea")]
    },
    {
      id: "scan_1",
      url: "/cards/scan_1.jpg",
      width: 488,
      height: 680,
      matches: [match("gamma-id", "Gamma", "leb")]
    }
  ]
};

function renderPage() {
  const client = new QueryClient();
  return render(
    React.createElement(QueryClientProvider, { client }, React.createElement(ScanResultsPage))
  );
}

beforeEach(() => {
  mocks.scanResult = scanResult;
  mocks.activeCollection = { _id: "coll-1", name: "Main" };
  server.use(SET_ICON_HANDLER, CREATE_CARD_HANDLER);
});

describe("ScanResultsPage (master-detail)", () => {
  it("shows every scanned card as a tile in the overview", () => {
    renderPage();
    // Two de-skewed crops, one per scanned card, before any sheet is open.
    expect(screen.getAllByAltText("Scanned card")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Likely: Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Likely: Gamma/ })).toBeInTheDocument();
  });

  it("opens the detail sheet and pages between cards", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Likely: Alpha/ }));
    expect(await screen.findByText("Card 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next card/i }));
    expect(await screen.findByText("Card 2 of 2")).toBeInTheDocument();
  });

  it("marks a tile as added after adding from the detail sheet", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Likely: Alpha/ }));
    await user.click(await screen.findByRole("button", { name: "Add" }));

    // The Alpha tile underneath now reflects the added copy.
    await waitFor(() => expect(screen.getAllByText(/Added ×1/).length).toBeGreaterThanOrEqual(1));
  });
});

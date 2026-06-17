import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ScannedCardItem from "@/components/scan/ScannedCardItem";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderItem(card: any, activeCollection: any) {
  const client = new QueryClient();
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(ScannedCardItem, { card, activeCollection })
    )
  );
}

const twoMatches = {
  url: "/cards/crop-1.jpg",
  matches: [
    { scryfallId: "alpha-id", name: "Alpha", set: "lea", collectorNumber: "1", imageUrl: "http://img/a" },
    { scryfallId: "beta-id", name: "Beta", set: "leb", collectorNumber: "2", imageUrl: "http://img/b" }
  ]
};

let fetchMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ physicalCardIds: ["x"] }), {
      status: 201,
      headers: { "content-type": "application/json" }
    })
  );
});
afterEach(() => fetchMock.mockRestore());

describe("ScannedCardItem", () => {
  it("shows an empty state when there are no candidate matches", () => {
    renderItem({ url: "/cards/c.jpg", matches: [] }, { _id: "c1", name: "Main" });
    expect(screen.getByText(/no matches found/i)).toBeInTheDocument();
  });

  it("disables Add and explains why when there is no active collection", () => {
    renderItem(twoMatches, null);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByText(/no active collection/i)).toBeInTheDocument();
  });

  it("adds the selected printing with the chosen quantity", async () => {
    const user = userEvent.setup();
    renderItem(twoMatches, { _id: "coll-1", name: "Main" });

    // Switch selection to the second candidate.
    await user.click(screen.getByTitle(/Beta/));
    // Bump quantity to 2.
    await user.click(screen.getByLabelText("Increase quantity"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ cardId: "beta-id", collectionId: "coll-1", quantity: 2 });
  });

  it("enforces a minimum quantity of 1", async () => {
    const user = userEvent.setup();
    renderItem(twoMatches, { _id: "coll-1", name: "Main" });
    expect(screen.getByLabelText("Decrease quantity")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.quantity).toBe(1);
  });
});

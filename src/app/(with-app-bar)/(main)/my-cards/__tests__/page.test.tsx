import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import MyCardsPage from "@/app/(with-app-bar)/(main)/my-cards/page";
import type { DeckListSummary } from "@/types/Deck";
import type { CollectionListSummary } from "@/types/Collection";

const mocks = vi.hoisted(() => ({
  decks: [] as DeckListSummary[],
  collections: [] as CollectionListSummary[]
}));

vi.mock("@/hooks/react-query/useRetrieveDeckSummaries", () => ({
  useRetrieveDeckSummaries: () => ({ data: { decks: mocks.decks } })
}));
vi.mock("@/hooks/react-query/useRetrieveCollectionSummaries", () => ({
  useRetrieveCollectionSummaries: () => ({ data: { collections: mocks.collections } })
}));
vi.mock("@/hooks/react-query/useCreateCollection", () => ({
  useCreateCollection: () => ({ mutate: vi.fn(), isPending: false })
}));
vi.mock("@/hooks/react-query/useCreateDeck", () => ({
  useCreateDeck: () => ({ mutate: vi.fn(), isPending: false })
}));

function deck(fields: Partial<DeckListSummary> & { _id: string; name: string }): DeckListSummary {
  return {
    kind: "deck",
    owner: "owner-1",
    description: "",
    cardCount: 0,
    ...fields
  };
}

beforeEach(() => {
  mocks.decks = [];
  mocks.collections = [];
});

describe("My Cards page", () => {
  it("lists each deck with its description and card count", () => {
    mocks.decks = [
      deck({ _id: "d1", name: "Mono Red", description: "Aggro brew", cardCount: 60 }),
      deck({ _id: "d2", name: "Sketchpad", cardCount: 1 })
    ];

    render(<MyCardsPage />);

    const monoRed = screen.getByRole("link", { name: /Mono Red/ });
    expect(monoRed).toHaveAttribute("href", "/my-cards/decks/d1");
    expect(monoRed).toHaveTextContent("Aggro brew");
    expect(monoRed).toHaveTextContent("60 cards");

    // Singular count, and no description line when the deck has none.
    const sketchpad = screen.getByRole("link", { name: /Sketchpad/ });
    expect(sketchpad).toHaveTextContent("1 card");
    expect(sketchpad).not.toHaveTextContent("Aggro brew");
  });

  it("lists each collection with its description, card count, and detail-page link", () => {
    mocks.collections = [
      {
        _id: "c1",
        name: "Main Collection",
        kind: "collection",
        owner: "owner-1",
        description: "Everything I own",
        cardCount: 1234
      }
    ];

    render(<MyCardsPage />);

    const main = screen.getByRole("link", { name: /Main Collection/ });
    expect(main).toHaveAttribute("href", "/my-cards/collections/c1");
    expect(main).toHaveTextContent("Everything I own");
    expect(main).toHaveTextContent("1234 cards");
  });

  it("shows empty states when there are no collections or decks", () => {
    render(<MyCardsPage />);

    expect(screen.getByText("No collections yet.")).toBeInTheDocument();
    expect(screen.getByText("No decks yet.")).toBeInTheDocument();
  });
});

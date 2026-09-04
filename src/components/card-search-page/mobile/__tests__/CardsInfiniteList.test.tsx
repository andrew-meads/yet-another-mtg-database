import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// jsdom has no layout, so the real virtualizer renders nothing — stub it out.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 80,
    getVirtualItems: () => [],
    measureElement: () => {},
    scrollToOffset: () => {},
    scrollOffset: 0
  })
}));

import CardsInfiniteList from "@/components/card-search-page/mobile/CardsInfiniteList";

function renderList(query: string, isLoading = false) {
  render(
    <CardsInfiniteList
      cardPages={[]}
      isLoading={isLoading}
      error={null}
      hasNextPage={false}
      isFetchingNextPage={false}
      fetchNextPage={() => {}}
      query={query}
    />
  );
}

describe("CardsInfiniteList empty state", () => {
  it("shows the plain empty message for an ordinary query", () => {
    renderList("t:dreadnought");
    expect(screen.getByText("No cards found")).toBeInTheDocument();
    expect(screen.queryByTestId("noughty-easter-egg")).not.toBeInTheDocument();
  });

  it("reveals the mascot when the query is the mascot's name", () => {
    renderList("NOUGHTY THE DREADNOUGHT");
    expect(screen.getByTestId("noughty-easter-egg")).toBeInTheDocument();
    expect(screen.queryByText("No cards found")).not.toBeInTheDocument();
  });

  it("shows nothing while loading", () => {
    renderList("noughty the dreadnought", true);
    expect(screen.queryByTestId("noughty-easter-egg")).not.toBeInTheDocument();
    expect(screen.queryByText("No cards found")).not.toBeInTheDocument();
  });
});

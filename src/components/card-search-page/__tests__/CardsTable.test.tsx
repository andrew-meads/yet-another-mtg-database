import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CardsTable from "@/components/card-search-page/CardsTable";

describe("CardsTable empty state", () => {
  it("shows the plain empty message for an ordinary query", () => {
    render(<CardsTable cards={[]} query="phyrexian dreadnought" />);
    expect(screen.getByText("No cards found")).toBeInTheDocument();
    expect(screen.queryByTestId("noughty-easter-egg")).not.toBeInTheDocument();
  });

  it("reveals the mascot when the query is the mascot's name", () => {
    render(<CardsTable cards={[]} query="Noughty the Dreadnought" />);
    expect(screen.getByTestId("noughty-easter-egg")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/noughty.png");
    expect(screen.queryByText("No cards found")).not.toBeInTheDocument();
  });

  it("accepts a quoted name: search", () => {
    render(<CardsTable cards={[]} query='name:"noughty the dreadnought"' />);
    expect(screen.getByTestId("noughty-easter-egg")).toBeInTheDocument();
  });

  it("does not show the mascot while loading, even for the trigger query", () => {
    render(<CardsTable cards={[]} isLoading query="noughty the dreadnought" />);
    expect(screen.getByText("Loading cards...")).toBeInTheDocument();
    expect(screen.queryByTestId("noughty-easter-egg")).not.toBeInTheDocument();
  });
});

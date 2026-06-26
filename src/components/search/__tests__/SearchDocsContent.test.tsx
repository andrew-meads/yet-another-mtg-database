import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SearchDocsContent from "@/components/search/SearchDocsContent";

describe("SearchDocsContent", () => {
  it("renders operator sections and example chips", () => {
    render(<SearchDocsContent onInsertExample={vi.fn()} />);

    // A representative example chip from the Numbers section.
    expect(screen.getByRole("button", { name: "mv>=5" })).toBeInTheDocument();
    // ...and a color example.
    expect(screen.getByRole("button", { name: "c:azorius" })).toBeInTheDocument();
  });

  it("calls onInsertExample with the clicked example's query", () => {
    const onInsertExample = vi.fn();
    render(<SearchDocsContent onInsertExample={onInsertExample} />);

    fireEvent.click(screen.getByRole("button", { name: "mv>=5" }));
    expect(onInsertExample).toHaveBeenCalledWith("mv>=5");
  });
});

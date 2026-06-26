import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import CardSearchBar from "@/components/search/CardSearchBar";
import SearchDocsPanel from "@/components/search/SearchDocsPanel";
import { SearchDocsProvider, useSearchDocs } from "@/context/SearchDocsContext";

/**
 * Mirrors how MainWorkspace hosts the docked docs panel: the bar and the panel
 * share a SearchDocsProvider, and the panel only mounts while `open`.
 */
function DocsHost(props: React.ComponentProps<typeof CardSearchBar>) {
  const { open } = useSearchDocs();
  return (
    <>
      <CardSearchBar {...props} />
      {open && <SearchDocsPanel />}
    </>
  );
}

function SearchBarWithDocs(props: React.ComponentProps<typeof CardSearchBar>) {
  return (
    <SearchDocsProvider>
      <DocsHost {...props} />
    </SearchDocsProvider>
  );
}

describe("CardSearchBar", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits the debounced query as the user types", () => {
    const onQueryChange = vi.fn();
    render(<CardSearchBar onQueryChange={onQueryChange} debounceMs={300} />);

    fireEvent.change(screen.getByPlaceholderText(/Try:/), { target: { value: "t:creature" } });
    expect(onQueryChange).not.toHaveBeenCalledWith("t:creature");

    act(() => vi.advanceTimersByTime(350));
    expect(onQueryChange).toHaveBeenLastCalledWith("t:creature");
  });

  it("seeds the input from initialQuery", () => {
    render(<CardSearchBar onQueryChange={vi.fn()} initialQuery="t:creature" />);
    expect((screen.getByPlaceholderText(/Try:/) as HTMLInputElement).value).toBe("t:creature");
  });

  it("only shows owned / default-filter toggles when enabled", () => {
    const { rerender } = render(<CardSearchBar onQueryChange={vi.fn()} />);
    expect(screen.queryByLabelText("Filter to owned cards only")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Use default filters")).not.toBeInTheDocument();

    rerender(
      <CardSearchBar
        onQueryChange={vi.fn()}
        showOwned
        owned={false}
        onOwnedChange={vi.fn()}
        showDefaultFilters
        useDefaultFilters
        onDefaultFiltersChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Filter to owned cards only")).toBeInTheDocument();
    expect(screen.getByLabelText("Use default filters")).toBeInTheDocument();
  });

  it("clears the search string when the clear button is clicked", () => {
    const onQueryChange = vi.fn();
    render(<CardSearchBar onQueryChange={onQueryChange} debounceMs={300} />);

    const input = screen.getByPlaceholderText(/Try:/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "t:creature" } });
    expect(input.value).toBe("t:creature");

    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(input.value).toBe("");

    act(() => vi.advanceTimersByTime(350));
    expect(onQueryChange).toHaveBeenLastCalledWith("");
  });

  it("toggles the docked docs panel from the Help button", () => {
    render(<SearchBarWithDocs onQueryChange={vi.fn()} />);

    expect(screen.queryByText("Search syntax")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Search help"));
    expect(screen.getByText("Search syntax")).toBeInTheDocument();
    // Clicking Help again closes it.
    fireEvent.click(screen.getByLabelText("Search help"));
    expect(screen.queryByText("Search syntax")).not.toBeInTheDocument();
  });

  it("appends a clicked docs example to the existing query without closing the panel", () => {
    const onQueryChange = vi.fn();
    render(
      <SearchBarWithDocs onQueryChange={onQueryChange} initialQuery="t:creature" debounceMs={300} />
    );

    fireEvent.click(screen.getByLabelText("Search help"));
    fireEvent.click(screen.getByRole("button", { name: "mv>=5" }));

    const input = screen.getByPlaceholderText(/Try:/) as HTMLInputElement;
    // Appended (space-separated), not replaced.
    expect(input.value).toBe("t:creature mv>=5");
    // The panel stays open so users can compose from several examples.
    expect(screen.getByText("Search syntax")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(350));
    expect(onQueryChange).toHaveBeenLastCalledWith("t:creature mv>=5");
  });

  it("builds a query string from the Advanced dialog and writes it into the bar", async () => {
    vi.useRealTimers(); // Radix dialog + waitFor need real timers.
    const onQueryChange = vi.fn();
    render(<CardSearchBar onQueryChange={onQueryChange} debounceMs={50} />);

    fireEvent.click(screen.getByLabelText("Search builder"));

    // The dialog's Card Name field maps to the `name:` operator.
    const nameInput = await screen.findByPlaceholderText("e.g., Lightning Bolt");
    fireEvent.change(nameInput, { target: { value: "Bolt" } });

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // The text bar now holds the generated query.
    expect((screen.getByPlaceholderText(/Try:/) as HTMLInputElement).value).toBe("name:Bolt");

    // ...and it is emitted (debounced) to the parent.
    await waitFor(() => expect(onQueryChange).toHaveBeenLastCalledWith("name:Bolt"));
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import CardSearchBar from "@/components/search/CardSearchBar";

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

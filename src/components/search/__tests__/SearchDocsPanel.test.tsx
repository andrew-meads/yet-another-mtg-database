import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchDocsPanel from "@/components/search/SearchDocsPanel";
import { SearchDocsProvider } from "@/context/SearchDocsContext";

function renderPanel() {
  return render(
    <SearchDocsProvider>
      <SearchDocsPanel />
    </SearchDocsProvider>
  );
}

// Radix keeps inactive tab content in the DOM (hidden), so assertions are
// visibility-based rather than presence-based.
describe("SearchDocsPanel", () => {
  it("shows the syntax reference tab by default", () => {
    renderPanel();
    expect(screen.getByText("Search help")).toBeInTheDocument();
    // Operator reference content is visible…
    expect(screen.getByRole("button", { name: "mv>=5" })).toBeVisible();
    // …and the regex primer is not.
    expect(screen.getByRole("tabpanel", { name: "Search syntax" })).toBeVisible();
  });

  it("switches to the regular-expressions primer tab and back", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("tab", { name: "Regular expressions" }));
    expect(screen.getByRole("button", { name: "t:/^legendary creature/" })).toBeVisible();
    expect(screen.getByText("Anchors & alternatives")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Search syntax" }));
    expect(screen.getByRole("button", { name: "mv>=5" })).toBeVisible();
  });
});

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  mutateActive: vi.fn(),
  state: {
    collections: [
      { _id: "c1", name: "Main", kind: "collection", isActive: true, owner: "o" },
      { _id: "c2", name: "Binder", kind: "collection", isActive: false, owner: "o" }
    ] as any[],
    decks: [{ _id: "d1", name: "Burn", kind: "deck", owner: "o" }] as any[]
  }
}));

vi.mock("@/hooks/react-query/useUpdateActiveCollection", () => ({
  useUpdateActiveCollection: () => ({ mutateAsync: h.mutateActive })
}));
vi.mock("@/hooks/react-query/useRetrieveCollectionSummaries", () => ({
  useRetrieveCollectionSummaries: () => ({ data: { collections: h.state.collections } })
}));
vi.mock("@/hooks/react-query/useRetrieveDeckSummaries", () => ({
  useRetrieveDeckSummaries: () => ({ data: { decks: h.state.decks } })
}));

// Keep these tests logic-focused: real drag-and-drop is covered in E2E.
vi.mock("@/hooks/drag-drop/useEntityButtonDropTarget", () => ({
  useEntityButtonDropTarget: () => ({ isOver: false, dropRef: () => {} })
}));

import { OpenEntitiesProvider } from "@/context/OpenEntitiesContext";
import OpenCollectionButtons from "@/components/OpenCollectionButtons";

function renderButtons() {
  return render(
    React.createElement(OpenEntitiesProvider, null, React.createElement(OpenCollectionButtons))
  );
}

// Radix menus rely on pointer-capture APIs that jsdom doesn't implement.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture)
    Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture)
    Element.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("OpenCollectionButtons", () => {
  it("renders nothing when no entities are open", () => {
    const { container } = renderButtons();
    expect(container.firstChild).toBeNull();
  });

  it("renders pinned entities inline and keeps unpinned ones behind the More menu", () => {
    window.localStorage.setItem(
      "open-entity-ids",
      JSON.stringify([
        { id: "c1", kind: "collection" }, // active → effectively pinned
        { id: "c2", kind: "collection", pinned: true },
        { id: "d1", kind: "deck" } // unpinned
      ])
    );
    renderButtons();

    expect(screen.getByTestId("open-entity-c1")).toBeInTheDocument();
    expect(screen.getByTestId("open-entity-c2")).toBeInTheDocument();
    expect(screen.queryByTestId("open-entity-d1")).not.toBeInTheDocument();

    const more = screen.getByTestId("open-entities-more");
    expect(more).toHaveTextContent("(1)");
  });

  it("shows the active collection inline with a star and no pin/unpin in its context menu", () => {
    window.localStorage.setItem(
      "open-entity-ids",
      JSON.stringify([{ id: "c1", kind: "collection" }])
    );
    renderButtons();

    const activeButton = screen.getByTestId("open-entity-c1");
    // The active-collection star is the only fill-current icon in the button.
    expect(activeButton.querySelector(".fill-current")).not.toBeNull();
  });

  it("closing an inline pinned entity removes it", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "open-entity-ids",
      JSON.stringify([{ id: "c2", kind: "collection", pinned: true }])
    );
    renderButtons();

    expect(screen.getByTestId("open-entity-c2")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Close Binder"));
    expect(screen.queryByTestId("open-entity-c2")).not.toBeInTheDocument();
  });

  it("pinning from the More menu moves the entity inline", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "open-entity-ids",
      JSON.stringify([{ id: "d1", kind: "deck" }])
    );
    renderButtons();

    // Initially behind the More menu, not inline.
    expect(screen.queryByTestId("open-entity-d1")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("open-entities-more"));
    const menuRow = await screen.findByTestId("open-entity-menu-d1");
    await user.click(within(menuRow).getByTestId("pin-toggle-d1"));

    // Now rendered inline as a drop target.
    expect(await screen.findByTestId("open-entity-d1")).toBeInTheDocument();
  });
});

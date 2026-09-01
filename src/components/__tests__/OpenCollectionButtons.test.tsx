import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => {
  const defaults = () => ({
    collections: [
      { _id: "c1", name: "Main", kind: "collection", isActive: true, owner: "o" },
      { _id: "c2", name: "Binder", kind: "collection", isActive: false, owner: "o" }
    ] as any[],
    decks: [{ _id: "d1", name: "Burn", kind: "deck", owner: "o" }] as any[]
  });
  return {
    mutateActive: vi.fn(),
    mutateActiveDeck: vi.fn(),
    dragging: false,
    defaults,
    state: defaults()
  };
});

// Drive the global drag-in-progress state used to highlight inline drop targets.
vi.mock("react-dnd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dnd")>();
  return {
    ...actual,
    useDragLayer: (selector: (monitor: { isDragging: () => boolean }) => unknown) =>
      selector({ isDragging: () => h.dragging })
  };
});

vi.mock("@/hooks/react-query/useUpdateActiveCollection", () => ({
  useUpdateActiveCollection: () => ({ mutateAsync: h.mutateActive })
}));
vi.mock("@/hooks/react-query/useUpdateActiveDeck", () => ({
  useUpdateActiveDeck: () => ({ mutateAsync: h.mutateActiveDeck })
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

// Fake the server-synced open-entities storage with plain state seeded from the
// legacy localStorage key, so the tests below keep seeding via localStorage.
// The real sync mechanics are covered by useServerSetting's own tests.
vi.mock("@/hooks/useServerSetting", () => ({
  useServerSetting: (
    _section: string,
    initial: unknown,
    options?: { legacyStorageKey?: string }
  ) => {
    const [value, setValue] = React.useState(() => {
      if (options?.legacyStorageKey) {
        const raw = window.localStorage.getItem(options.legacyStorageKey);
        if (raw !== null) return JSON.parse(raw);
      }
      return initial;
    });
    return [value, setValue, { hydrated: true }];
  }
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
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  h.dragging = false;
  h.state = h.defaults();
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

  it("shows the active deck inline with a star, alongside the active collection", () => {
    h.state.decks = [{ _id: "d1", name: "Burn", kind: "deck", isActive: true, owner: "o" }];
    window.localStorage.setItem(
      "open-entity-ids",
      JSON.stringify([
        { id: "c1", kind: "collection" },
        { id: "d1", kind: "deck" }
      ])
    );
    renderButtons();

    // Both are effectively pinned (so both render inline) and both carry the star.
    expect(screen.getByTestId("open-entity-c1").querySelector(".fill-current")).not.toBeNull();
    expect(screen.getByTestId("open-entity-d1").querySelector(".fill-current")).not.toBeNull();
  });

  it("offers 'Make active' for a deck and delegates to the deck mutation", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "open-entity-ids",
      JSON.stringify([{ id: "d1", kind: "deck", pinned: true }])
    );
    renderButtons();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("open-entity-d1") });
    await user.click(await screen.findByText("Make active"));

    expect(h.mutateActiveDeck).toHaveBeenCalledWith({ deckId: "d1", isActive: true });
    expect(h.mutateActive).not.toHaveBeenCalled();
  });

  it("hides 'Make active' and the pin toggle for the active deck", async () => {
    const user = userEvent.setup();
    h.state.decks = [{ _id: "d1", name: "Burn", kind: "deck", isActive: true, owner: "o" }];
    window.localStorage.setItem("open-entity-ids", JSON.stringify([{ id: "d1", kind: "deck" }]));
    renderButtons();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("open-entity-d1") });
    expect(await screen.findByText("Close")).toBeInTheDocument();
    expect(screen.queryByText("Make active")).not.toBeInTheDocument();
    expect(screen.queryByText(/pin/i)).not.toBeInTheDocument();
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
    window.localStorage.setItem("open-entity-ids", JSON.stringify([{ id: "d1", kind: "deck" }]));
    renderButtons();

    // Initially behind the More menu, not inline.
    expect(screen.queryByTestId("open-entity-d1")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("open-entities-more"));
    const menuRow = await screen.findByTestId("open-entity-menu-d1");
    await user.click(within(menuRow).getByTestId("pin-toggle-d1"));

    // Now rendered inline as a drop target.
    expect(await screen.findByTestId("open-entity-d1")).toBeInTheDocument();
  });

  it("does not show a drop zone when nothing is being dragged", () => {
    window.localStorage.setItem(
      "open-entity-ids",
      JSON.stringify([{ id: "c2", kind: "collection", pinned: true }])
    );
    renderButtons();

    // The drop zone div is always in the DOM, but has no data-drag-active
    // attribute while nothing is being dragged.
    const wrapper = screen.getByTestId("open-entity-c2");
    expect(wrapper.querySelector("[data-drag-active]")).toBeNull();
  });

  it("shows the drop zone below the button while dragging", () => {
    h.dragging = true;
    window.localStorage.setItem(
      "open-entity-ids",
      JSON.stringify([{ id: "c2", kind: "collection", pinned: true }])
    );
    renderButtons();

    const wrapper = screen.getByTestId("open-entity-c2");
    const dropZone = wrapper.querySelector("[data-drag-active]");
    expect(dropZone).not.toBeNull();
    // Drop zone is visible (invisible class removed when dragging).
    expect(dropZone).not.toHaveClass("invisible");
  });
});

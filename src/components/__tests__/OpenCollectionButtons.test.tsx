import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
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
    state: defaults(),
    /** Pre-seeded pinned refs (stands in for the server-stored value). */
    seedRefs: [] as any[],
    pathname: "/search"
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

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ push: vi.fn() })
}));

// Fake the server-synced pinned-entities storage with plain state seeded from
// h.seedRefs. The real sync mechanics are covered by useServerSetting's own tests.
vi.mock("@/hooks/useServerSetting", () => ({
  useServerSetting: (_section: string, initial: unknown) => {
    const [value, setValue] = React.useState(() => (h.seedRefs.length > 0 ? h.seedRefs : initial));
    return [value, setValue, { hydrated: true }];
  }
}));

import { OpenEntitiesProvider } from "@/context/OpenEntitiesContext";
import OpenCollectionButtons, { OpenCollectionsList } from "@/components/OpenCollectionButtons";

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
  h.seedRefs = [];
  h.pathname = "/search";
});

describe("OpenCollectionButtons", () => {
  it("renders nothing when the user has no collections or decks", () => {
    h.state.collections = [];
    h.state.decks = [];
    const { container } = renderButtons();
    expect(container.firstChild).toBeNull();
  });

  it("renders pinned entities inline and keeps every other one behind the More menu", async () => {
    const user = userEvent.setup();
    h.seedRefs = [{ id: "c2", kind: "collection" }];
    renderButtons();

    // c1 is active (so pinned), c2 is explicitly pinned, d1 is not.
    expect(screen.getByTestId("open-entity-c1")).toBeInTheDocument();
    expect(screen.getByTestId("open-entity-c2")).toBeInTheDocument();
    expect(screen.queryByTestId("open-entity-d1")).not.toBeInTheDocument();

    const more = screen.getByTestId("open-entities-more");
    expect(more).toHaveTextContent("(1)");
    await user.click(more);
    expect(await screen.findByTestId("open-entity-menu-d1")).toBeInTheDocument();
  });

  it("groups the More menu by kind", async () => {
    const user = userEvent.setup();
    renderButtons();

    await user.click(screen.getByTestId("open-entities-more"));
    expect(await screen.findByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("Decks")).toBeInTheDocument();
    expect(screen.getByTestId("open-entity-menu-c2")).toBeInTheDocument();
    expect(screen.getByTestId("open-entity-menu-d1")).toBeInTheDocument();
  });

  it("hides the More menu when everything is pinned", () => {
    h.seedRefs = [
      { id: "c2", kind: "collection" },
      { id: "d1", kind: "deck" }
    ];
    renderButtons();
    expect(screen.queryByTestId("open-entities-more")).not.toBeInTheDocument();
  });

  it("highlights the More trigger when the current page is an unpinned entity", () => {
    renderButtons();
    expect(screen.getByTestId("open-entities-more")).not.toHaveClass("bg-primary");
    cleanup();

    h.pathname = "/my-cards/decks/d1";
    renderButtons();
    expect(screen.getByTestId("open-entities-more")).toHaveClass("bg-primary");
  });

  it("shows the active collection inline with a star and no unpin button", () => {
    renderButtons();

    const activeButton = screen.getByTestId("open-entity-c1");
    // The active-collection star is the only fill-current icon in the button.
    expect(activeButton.querySelector(".fill-current")).not.toBeNull();
    expect(screen.queryByLabelText("Unpin Main")).not.toBeInTheDocument();
  });

  it("shows the active deck inline with a star, alongside the active collection", () => {
    h.state.decks = [{ _id: "d1", name: "Burn", kind: "deck", isActive: true, owner: "o" }];
    renderButtons();

    // Both are pinned automatically (so both render inline) and both carry the star.
    expect(screen.getByTestId("open-entity-c1").querySelector(".fill-current")).not.toBeNull();
    expect(screen.getByTestId("open-entity-d1").querySelector(".fill-current")).not.toBeNull();
  });

  it("offers 'Make active' for a deck and delegates to the deck mutation", async () => {
    const user = userEvent.setup();
    h.seedRefs = [{ id: "d1", kind: "deck" }];
    renderButtons();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("open-entity-d1") });
    await user.click(await screen.findByText("Make active"));

    expect(h.mutateActiveDeck).toHaveBeenCalledWith({ deckId: "d1", isActive: true });
    expect(h.mutateActive).not.toHaveBeenCalled();
  });

  it("hides 'Make active' and unpin for the active deck", async () => {
    const user = userEvent.setup();
    h.state.decks = [{ _id: "d1", name: "Burn", kind: "deck", isActive: true, owner: "o" }];
    renderButtons();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("open-entity-d1") });
    expect(await screen.findByText("Active decks stay pinned")).toBeInTheDocument();
    expect(screen.queryByText("Make active")).not.toBeInTheDocument();
    expect(screen.queryByText("Unpin from bar")).not.toBeInTheDocument();
  });

  it("the x button unpins an inline entity into the More menu", async () => {
    const user = userEvent.setup();
    h.seedRefs = [{ id: "c2", kind: "collection" }];
    renderButtons();

    expect(screen.getByTestId("open-entity-c2")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Unpin Binder"));
    expect(screen.queryByTestId("open-entity-c2")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("open-entities-more"));
    expect(await screen.findByTestId("open-entity-menu-c2")).toBeInTheDocument();
  });

  it("'Unpin from bar' in the context menu unpins the entity", async () => {
    const user = userEvent.setup();
    h.seedRefs = [{ id: "c2", kind: "collection" }];
    renderButtons();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("open-entity-c2") });
    await user.click(await screen.findByText("Unpin from bar"));
    expect(screen.queryByTestId("open-entity-c2")).not.toBeInTheDocument();
  });

  it("pinning from the More menu moves the entity inline", async () => {
    const user = userEvent.setup();
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
    h.seedRefs = [{ id: "c2", kind: "collection" }];
    renderButtons();

    // The drop zone div is always in the DOM, but has no data-drag-active
    // attribute while nothing is being dragged.
    const wrapper = screen.getByTestId("open-entity-c2");
    expect(wrapper.querySelector("[data-drag-active]")).toBeNull();
  });

  it("shows the drop zone below the button while dragging", () => {
    h.dragging = true;
    h.seedRefs = [{ id: "c2", kind: "collection" }];
    renderButtons();

    const wrapper = screen.getByTestId("open-entity-c2");
    const dropZone = wrapper.querySelector("[data-drag-active]");
    expect(dropZone).not.toBeNull();
    // Drop zone is visible (invisible class removed when dragging).
    expect(dropZone).not.toHaveClass("invisible");
  });
});

describe("OpenCollectionsList (mobile)", () => {
  function renderList() {
    return render(
      React.createElement(OpenEntitiesProvider, null, React.createElement(OpenCollectionsList))
    );
  }

  it("lists pinned entities first, then the rest under 'Not pinned'", () => {
    h.seedRefs = [{ id: "d1", kind: "deck" }];
    renderList();

    const rows = screen.getAllByTestId(/^mobile-entity-/).map((el) => el.dataset.testid);
    expect(rows).toEqual(["mobile-entity-c1", "mobile-entity-d1", "mobile-entity-c2"]);
    expect(screen.getByText("Not pinned")).toBeInTheDocument();
  });

  it("pins and unpins from the row buttons, but never offers unpin for the active entity", async () => {
    const user = userEvent.setup();
    renderList();

    expect(screen.queryByLabelText("Unpin Main")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Pin Burn"));
    expect(screen.getByLabelText("Unpin Burn")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Unpin Burn"));
    expect(screen.getByLabelText("Pin Burn")).toBeInTheDocument();
  });
});

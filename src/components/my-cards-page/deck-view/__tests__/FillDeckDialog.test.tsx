import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { MtgCard } from "@/types/MtgCard";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { DeckWithCards } from "@/types/Deck";

const h = vi.hoisted(() => ({
  fillDeck: vi.fn(),
  isPending: false,
  activeCollection: null as null | { _id: string; name: string },
  collectionCards: [] as unknown[],
  collectionLoading: false
}));

// Render the dialog inline so its content is always present (no portal deps).
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? React.createElement("div", null, children) : null,
  DialogContent: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": (props as never)["data-testid"] }, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h2", null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement("p", null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children)
}));

vi.mock("@/context/OpenEntitiesContext", () => ({
  useOpenEntitiesContext: () => ({ activeCollection: h.activeCollection })
}));
vi.mock("@/hooks/react-query/useRetrieveCollectionDetails", () => ({
  useRetrieveCollectionDetails: (collectionId: string | null) => ({
    data:
      collectionId && !h.collectionLoading
        ? { collection: { _id: collectionId, cards: h.collectionCards } }
        : undefined,
    isLoading: h.collectionLoading,
    isError: false
  })
}));
vi.mock("@/hooks/react-query/useFillDeck", () => ({
  useFillDeck: () => ({ mutateAsync: h.fillDeck, isPending: h.isPending })
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import FillDeckDialog from "@/components/my-cards-page/deck-view/FillDeckDialog";

function makeCard(overrides: Partial<MtgCard> = {}): MtgCard {
  return {
    id: "printing-1",
    name: "Lightning Bolt",
    oracle_id: "oracle-bolt",
    set: "lea",
    set_name: "Limited Edition Alpha",
    collector_number: "1",
    image_uris: { small: "https://cards.example/bolt-small.jpg" },
    ...overrides
  } as MtgCard;
}

const bolt = makeCard();
const boltReprint = makeCard({
  id: "printing-2",
  set: "m10",
  set_name: "Magic 2010",
  collector_number: "146"
});

function makeEphemeral(_id: string, card: MtgCard): DetailedPhysicalCard {
  return { _id, card, collectionId: null, isEphemeral: true };
}

function makeCollectionCard(
  _id: string,
  card: MtgCard,
  overrides: Partial<DetailedPhysicalCard> = {}
): DetailedPhysicalCard {
  return { _id, card, collectionId: "coll-1", ...overrides };
}

function makeDeck(cards: DetailedPhysicalCard[]): DeckWithCards {
  return {
    _id: "deck-1",
    name: "Test Deck",
    kind: "deck",
    owner: "user-1",
    description: "",
    sections: [{ _id: "sec-1", name: "Main", columns: [{ _id: "col-1", cards }] }]
  };
}

function renderDialog(deck: DeckWithCards) {
  // CardArtView (the candidate thumbnails) uses react-dnd, so a DnD context is required.
  return render(
    React.createElement(
      DndProvider,
      { backend: HTML5Backend },
      React.createElement(FillDeckDialog, { deck, open: true, onOpenChange: vi.fn() })
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.fillDeck.mockResolvedValue({ ok: true, filled: 1 });
  h.isPending = false;
  h.activeCollection = { _id: "coll-1", name: "Main Collection" };
  h.collectionCards = [];
  h.collectionLoading = false;
});

describe("FillDeckDialog", () => {
  it("renders a group per card with its needed count and candidates", () => {
    h.collectionCards = [
      makeCollectionCard("r-same", bolt),
      makeCollectionCard("r-other", boltReprint)
    ];
    renderDialog(makeDeck([makeEphemeral("e1", bolt), makeEphemeral("e2", bolt)]));

    expect(screen.getByText("Lightning Bolt")).toBeInTheDocument();
    expect(screen.getByText("needs 2")).toBeInTheDocument();
    expect(screen.getByTestId("fill-candidate-r-same")).toBeInTheDocument();
    expect(screen.getByTestId("fill-candidate-r-other")).toBeInTheDocument();
    expect(screen.getByText("Same printing")).toBeInTheDocument();
  });

  it("renders a card thumbnail for each candidate", () => {
    h.collectionCards = [
      makeCollectionCard("r-same", bolt),
      makeCollectionCard("r-other", boltReprint)
    ];
    renderDialog(makeDeck([makeEphemeral("e1", bolt)]));

    expect(screen.getAllByRole("img", { name: "Lightning Bolt" })).toHaveLength(2);
  });

  it("clicking a candidate's thumbnail flips multi-faced cards without toggling the checkbox", async () => {
    const user = userEvent.setup();
    const mdfc = makeCard({
      id: "printing-mdfc",
      name: "Delver of Secrets // Insectile Aberration",
      image_uris: undefined,
      card_faces: [
        { name: "Delver of Secrets", image_uris: { small: "https://cards.example/front.jpg" } },
        { name: "Insectile Aberration", image_uris: { small: "https://cards.example/back.jpg" } }
      ]
    } as Partial<MtgCard>);
    h.collectionCards = [makeCollectionCard("r-mdfc", mdfc)];
    renderDialog(makeDeck([makeEphemeral("e1", mdfc)]));

    // Both faces are rendered (stacked); the front starts visible.
    const front = screen.getByRole("img", { name: "Delver of Secrets" });
    const back = screen.getByRole("img", { name: "Insectile Aberration" });
    const faceWrapper = (img: HTMLElement) => img.parentElement!.parentElement!;
    expect(faceWrapper(front)).toHaveStyle({ opacity: "1" });
    expect(faceWrapper(back)).toHaveStyle({ opacity: "0" });

    await user.click(front);

    expect(faceWrapper(front)).toHaveStyle({ opacity: "0" });
    expect(faceWrapper(back)).toHaveStyle({ opacity: "1" });
    // The wrapping label must not have forwarded the click to the checkbox.
    expect(screen.getByTestId("fill-candidate-r-mdfc")).not.toBeChecked();
  });

  it("shows a candidate's tags", () => {
    h.collectionCards = [
      makeCollectionCard("r-tagged", bolt, { tags: ["trade", "foil"] }),
      makeCollectionCard("r-untagged", boltReprint)
    ];
    renderDialog(makeDeck([makeEphemeral("e1", bolt)]));

    expect(screen.getByText("trade, foil")).toBeInTheDocument();
  });

  it("caps the selection at the group's needed count", async () => {
    const user = userEvent.setup();
    h.collectionCards = [
      makeCollectionCard("r1", bolt),
      makeCollectionCard("r2", bolt),
      makeCollectionCard("r3", bolt)
    ];
    renderDialog(makeDeck([makeEphemeral("e1", bolt), makeEphemeral("e2", bolt)]));

    await user.click(screen.getByTestId("fill-candidate-r1"));
    await user.click(screen.getByTestId("fill-candidate-r2"));
    expect(screen.getByTestId("fill-candidate-r3")).toBeDisabled();

    // Unchecking frees the cap again.
    await user.click(screen.getByTestId("fill-candidate-r1"));
    expect(screen.getByTestId("fill-candidate-r3")).toBeEnabled();
  });

  it("confirm sends the paired swaps to the fill mutation", async () => {
    const user = userEvent.setup();
    h.collectionCards = [makeCollectionCard("r-same", bolt)];
    renderDialog(makeDeck([makeEphemeral("e1", bolt)]));

    await user.click(screen.getByTestId("fill-candidate-r-same"));
    await user.click(screen.getByTestId("fill-deck-confirm"));

    await waitFor(() =>
      expect(h.fillDeck).toHaveBeenCalledWith({
        deckId: "deck-1",
        swaps: [{ ephemeralId: "e1", physicalCardId: "r-same" }]
      })
    );
  });

  it("confirm is disabled with nothing selected", () => {
    h.collectionCards = [makeCollectionCard("r1", bolt)];
    renderDialog(makeDeck([makeEphemeral("e1", bolt)]));
    expect(screen.getByTestId("fill-deck-confirm")).toBeDisabled();
  });

  it("shows an empty state when the deck has no ephemeral cards", () => {
    renderDialog(makeDeck([]));
    expect(screen.getByText("This deck has no ephemeral cards to fill.")).toBeInTheDocument();
  });

  it("shows a per-group empty state when the collection has no matching cards", () => {
    renderDialog(makeDeck([makeEphemeral("e1", bolt)]));
    expect(screen.getByText("No matching cards in Main Collection.")).toBeInTheDocument();
  });

  it("prompts for an active collection and disables confirm when there is none", () => {
    h.activeCollection = null;
    renderDialog(makeDeck([makeEphemeral("e1", bolt)]));
    expect(
      screen.getByText("Set an active collection to fill this deck from.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("fill-deck-confirm")).toBeDisabled();
  });
});

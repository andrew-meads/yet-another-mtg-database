import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SlimMtgCard } from "@/types/MtgCard";

// Drag-and-drop needs a DndProvider; this test is about image loading only.
vi.mock("@/hooks/drag-drop/useNewCardDragSource", () => ({
  useNewCardDragSource: () => ({ isDragging: false, dragRef: vi.fn() })
}));

import CardArtView, { SimpleCardArtView } from "@/components/CardArtView";

function makeCard(id: string): SlimMtgCard {
  return {
    id,
    name: `Card ${id}`,
    image_uris: {
      small: `https://cards.scryfall.io/small/${id}.jpg`,
      normal: `https://cards.scryfall.io/normal/${id}.jpg`,
      large: `https://cards.scryfall.io/large/${id}.jpg`
    }
  } as unknown as SlimMtgCard;
}

const bolt = makeCard("bolt");
const bear = makeCard("bear");

describe("CardArtView image loading", () => {
  it("shows a placeholder until the image has loaded, then hides it", () => {
    render(<CardArtView card={bolt} variant="large" width="100%" height="100%" />);

    expect(screen.getByTestId("card-image-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("card-image")).toHaveAttribute("data-loaded", "false");

    fireEvent.load(screen.getByRole("img", { name: "Card bolt" }));

    expect(screen.queryByTestId("card-image-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-image")).toHaveAttribute("data-loaded", "true");
  });

  it("swaps a loaded card for the placeholder (not the stale image) when the card changes", () => {
    const { rerender } = render(
      <CardArtView card={bolt} variant="large" width="100%" height="100%" />
    );
    fireEvent.load(screen.getByRole("img", { name: "Card bolt" }));
    expect(screen.queryByTestId("card-image-placeholder")).not.toBeInTheDocument();

    rerender(<CardArtView card={bear} variant="large" width="100%" height="100%" />);

    // The previous card's <img> is gone (the image is keyed by its URI) and the
    // placeholder is back until the new one loads.
    expect(screen.queryByRole("img", { name: "Card bolt" })).not.toBeInTheDocument();
    expect(screen.getByTestId("card-image-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("card-image")).toHaveAttribute("data-loaded", "false");

    fireEvent.load(screen.getByRole("img", { name: "Card bear" }));
    expect(screen.queryByTestId("card-image-placeholder")).not.toBeInTheDocument();
  });

  it("falls back to the 'no image' box when the image fails to load", () => {
    render(<CardArtView card={bolt} variant="large" width="100%" height="100%" />);
    fireEvent.error(screen.getByRole("img", { name: "Card bolt" }));

    expect(screen.queryByTestId("card-image-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-image-unavailable")).toHaveTextContent(
      "No image available for Card bolt"
    );
  });

  it("renders the 'no image' box (no placeholder) for a card without images", () => {
    const noArt = { id: "x", name: "Blank" } as unknown as SlimMtgCard;
    render(<CardArtView card={noArt} variant="large" width="100%" height="100%" />);
    expect(screen.getByTestId("card-image-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("card-image-placeholder")).not.toBeInTheDocument();
  });

  it("gives a flippable multi-faced card one placeholder per face", () => {
    const dfc = {
      id: "dfc",
      name: "Delver // Insectile",
      card_faces: [
        { name: "Delver of Secrets", image_uris: { large: "https://cards.scryfall.io/l/a.jpg" } },
        { name: "Insectile Aberration", image_uris: { large: "https://cards.scryfall.io/l/b.jpg" } }
      ]
    } as unknown as SlimMtgCard;
    render(<CardArtView card={dfc} variant="large" flippable width="100%" height="100%" />);
    expect(screen.getAllByTestId("card-image-placeholder")).toHaveLength(2);

    fireEvent.load(screen.getByRole("img", { name: "Delver of Secrets" }));
    expect(screen.getAllByTestId("card-image-placeholder")).toHaveLength(1);
  });
});

describe("SimpleCardArtView image loading", () => {
  it("uses the same placeholder-until-loaded behaviour (deck view thumbnails)", () => {
    const { rerender } = render(
      <SimpleCardArtView card={bolt} variant="normal" width={150} height={210} />
    );
    expect(screen.getByTestId("card-image-placeholder")).toBeInTheDocument();

    fireEvent.load(screen.getByRole("img", { name: "Card bolt" }));
    expect(screen.queryByTestId("card-image-placeholder")).not.toBeInTheDocument();

    rerender(<SimpleCardArtView card={bear} variant="normal" width={150} height={210} />);
    expect(screen.getByTestId("card-image-placeholder")).toBeInTheDocument();
  });
});

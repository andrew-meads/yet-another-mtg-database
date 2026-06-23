import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import CardPopup, { type CardPopupProps } from "@/components/CardPopup";
import { MtgCard } from "@/types/MtgCard";

const renderPopup = (props: CardPopupProps) =>
  render(
    <DndProvider backend={HTML5Backend}>
      <CardPopup {...props} />
    </DndProvider>
  );

const card = {
  id: "card-1",
  name: "Test Card",
  image_uris: {
    small: "https://cards.scryfall.io/small.jpg",
    normal: "https://cards.scryfall.io/normal.jpg",
    large: "https://cards.scryfall.io/large.jpg"
  }
} as unknown as MtgCard;

const position = { x: 100, y: 100 };

describe("CardPopup size", () => {
  it("defaults to the normal image variant and 400px container", () => {
    const { container } = renderPopup({ card, position });
    expect(screen.getByAltText("Test Card")).toHaveAttribute("src", card.image_uris!.normal);
    const inner = container.querySelector<HTMLDivElement>("div[style*='height']");
    expect(inner?.style.height).toBe("400px");
  });

  it("uses the small variant and a smaller container for size='small'", () => {
    const { container } = renderPopup({ card, position, size: "small" });
    expect(screen.getByAltText("Test Card")).toHaveAttribute("src", card.image_uris!.small);
    const inner = container.querySelector<HTMLDivElement>("div[style*='height']");
    expect(inner?.style.height).toBe("260px");
  });

  it("uses the large variant and a larger container for size='large'", () => {
    const { container } = renderPopup({ card, position, size: "large" });
    expect(screen.getByAltText("Test Card")).toHaveAttribute("src", card.image_uris!.large);
    const inner = container.querySelector<HTMLDivElement>("div[style*='height']");
    expect(inner?.style.height).toBe("540px");
  });
});

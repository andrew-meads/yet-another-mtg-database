import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import CardAttributeBadges from "@/components/CardAttributeBadges";

describe("CardAttributeBadges", () => {
  it("renders nothing for an ordinary copy (unset or explicit defaults)", () => {
    const { container } = render(<CardAttributeBadges />);
    expect(container).toBeEmptyDOMElement();
    const { container: explicit } = render(<CardAttributeBadges finish="nonfoil" condition="NM" />);
    expect(explicit).toBeEmptyDOMElement();
  });

  it("renders a finish badge alone", () => {
    render(<CardAttributeBadges finish="etched" />);
    const badges = screen.getByTestId("card-attribute-badges");
    expect(badges).toHaveTextContent("Etched");
    expect(badges.children).toHaveLength(1);
  });

  it("renders a condition badge alone", () => {
    render(<CardAttributeBadges condition="DMG" />);
    expect(screen.getByTestId("card-attribute-badges")).toHaveTextContent("DMG");
  });

  it("renders both when both differ from the defaults", () => {
    render(<CardAttributeBadges finish="foil" condition="MP" variant="overlay" />);
    const badges = screen.getByTestId("card-attribute-badges");
    expect(badges).toHaveTextContent("Foil");
    expect(badges).toHaveTextContent("MP");
    expect(badges.children).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import PriceAgeDot from "@/components/pricing/PriceAgeDot";

const HOUR = 3_600_000;

describe("PriceAgeDot", () => {
  it.each([
    ["fresh", new Date(Date.now() - HOUR)],
    ["aging", new Date(Date.now() - 3 * 24 * HOUR)],
    ["stale", new Date(Date.now() - 30 * 24 * HOUR)],
    ["unknown", null]
  ])("marks a %s price", (level, stamp) => {
    render(<PriceAgeDot updatedAt={stamp} />);
    expect(screen.getByRole("img")).toHaveAttribute("data-age-level", level);
  });

  it("describes the age in the accessible label", () => {
    render(<PriceAgeDot updatedAt={new Date(Date.now() - 2 * HOUR)} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/updated 2 hours ago/);
    render(<PriceAgeDot updatedAt={null} />);
    expect(screen.getAllByRole("img")[1]).toHaveAccessibleName(/never fetched/);
  });
});

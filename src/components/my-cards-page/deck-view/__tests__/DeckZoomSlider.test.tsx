import { describe, it, expect, vi, beforeAll } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeckZoomSlider from "@/components/my-cards-page/deck-view/DeckZoomSlider";

// Radix Slider measures itself with ResizeObserver, which jsdom doesn't ship.
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

/** The slider wired to real state, reporting every change. */
function Harness({ initial, onChange }: { initial: number; onChange?: (z: number) => void }) {
  const [zoom, setZoom] = useState(initial);
  return (
    <DeckZoomSlider
      zoom={zoom}
      onZoomChange={(z) => {
        onChange?.(z);
        setZoom(z);
      }}
    />
  );
}

describe("DeckZoomSlider", () => {
  it("shows the zoom as a percentage, with an accessible thumb", () => {
    render(<Harness initial={75} />);
    expect(screen.getByTestId("deck-zoom-value")).toHaveTextContent("75%");
    const thumb = screen.getByRole("slider", { name: "Zoom" });
    expect(thumb).toHaveAttribute("aria-valuetext", "75%");
  });

  it("places 100% at the middle of the track", () => {
    render(<Harness initial={100} />);
    const thumb = screen.getByRole("slider", { name: "Zoom" });
    expect(Number(thumb.getAttribute("aria-valuenow"))).toBe(
      (Number(thumb.getAttribute("aria-valuemin")) + Number(thumb.getAttribute("aria-valuemax"))) /
        2
    );
  });

  it("clamps an out-of-range zoom for display", () => {
    render(<Harness initial={999} />);
    expect(screen.getByTestId("deck-zoom-value")).toHaveTextContent("200%");
  });

  it("lets arrow keys step away from 100% instead of snapping back", () => {
    const onChange = vi.fn();
    render(<Harness initial={100} onChange={onChange} />);
    const thumb = screen.getByRole("slider", { name: "Zoom" });

    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(101);
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(99);
    expect(screen.getByTestId("deck-zoom-value")).toHaveTextContent("99%");
  });

  it("jumps to the ends with Home and End", () => {
    render(<Harness initial={100} />);
    const thumb = screen.getByRole("slider", { name: "Zoom" });
    fireEvent.keyDown(thumb, { key: "End" });
    expect(screen.getByTestId("deck-zoom-value")).toHaveTextContent("200%");
    fireEvent.keyDown(thumb, { key: "Home" });
    expect(screen.getByTestId("deck-zoom-value")).toHaveTextContent("20%");
  });

  it("resets to 100% from the percentage button", async () => {
    const onChange = vi.fn();
    render(<Harness initial={160} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("deck-zoom-value"));
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(screen.getByTestId("deck-zoom-value")).toHaveTextContent("100%");
  });
});

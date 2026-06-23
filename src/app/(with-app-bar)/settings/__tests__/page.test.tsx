import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SettingsPage from "@/app/(with-app-bar)/settings/page";
import { SettingsProvider } from "@/context/SettingsContext";

const KEY = "settings/card-preview";

function renderPage() {
  return render(
    <SettingsProvider>
      <SettingsPage />
    </SettingsProvider>
  );
}

beforeEach(() => window.localStorage.clear());

describe("SettingsPage", () => {
  it("toggling the switch persists the enabled flag immediately", () => {
    renderPage();
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toMatchObject({ enabled: false });
  });

  it("moving the delay slider via keyboard persists a stepped value", () => {
    renderPage();
    // Sliders render in order: [size, delay].
    const sliders = screen.getAllByRole("slider");
    const delaySlider = sliders[1];

    delaySlider.focus();
    fireEvent.keyDown(delaySlider, { key: "ArrowRight" });

    // Default 500 + 100ms step = 600
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toMatchObject({ delayMs: 600 });
    expect(screen.getByText("600ms")).toBeInTheDocument();
  });

  it("disables the sliders when the preview is turned off", () => {
    renderPage();
    fireEvent.click(screen.getByRole("switch"));
    for (const slider of screen.getAllByRole("slider")) {
      expect(slider).toHaveAttribute("data-disabled");
    }
  });
});

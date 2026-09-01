import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The server-sync mechanics are covered by useServerSetting's own tests, and the
 * AI section (server round-trips) by AiSettingsSection's; fake both here so the
 * page tests focus on the card-preview controls.
 */
const h = vi.hoisted(() => ({
  writes: [] as unknown[]
}));

vi.mock("@/hooks/useServerSetting", () => ({
  useServerSetting: (_section: string, initial: unknown) => {
    const [value, setValue] = React.useState(initial);
    const set = (next: unknown | ((prev: unknown) => unknown)) => {
      setValue((prev: unknown) => {
        const resolved = next instanceof Function ? next(prev) : next;
        h.writes.push(resolved);
        return resolved;
      });
    };
    return [value, set, { hydrated: true }];
  }
}));

vi.mock("@/components/settings/AiSettingsSection", () => ({
  default: () => <div data-testid="ai-settings-section" />
}));

import SettingsPage from "@/app/(with-app-bar)/settings/page";
import { SettingsProvider } from "@/context/SettingsContext";

function renderPage() {
  return render(
    <SettingsProvider>
      <SettingsPage />
    </SettingsProvider>
  );
}

beforeEach(() => {
  h.writes = [];
});

describe("SettingsPage", () => {
  it("toggling the switch persists the enabled flag immediately", () => {
    renderPage();
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(h.writes.at(-1)).toMatchObject({ enabled: false });
  });

  it("moving the delay slider via keyboard persists a stepped value", () => {
    renderPage();
    // Sliders render in order: [size, delay].
    const sliders = screen.getAllByRole("slider");
    const delaySlider = sliders[1];

    delaySlider.focus();
    fireEvent.keyDown(delaySlider, { key: "ArrowRight" });

    // Default 500 + 100ms step = 600
    expect(h.writes.at(-1)).toMatchObject({ delayMs: 600 });
    expect(screen.getByText("600ms")).toBeInTheDocument();
  });

  it("disables the sliders when the preview is turned off", () => {
    renderPage();
    fireEvent.click(screen.getByRole("switch"));
    for (const slider of screen.getAllByRole("slider")) {
      expect(slider).toHaveAttribute("data-disabled");
    }
  });

  it("renders the AI settings section", () => {
    renderPage();
    expect(screen.getByTestId("ai-settings-section")).toBeInTheDocument();
  });
});

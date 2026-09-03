import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  exportDeck: vi.fn(),
  isPending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn()
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
vi.mock("@/hooks/react-query/useExportDeck", () => ({
  useExportDeck: () => ({ mutateAsync: h.exportDeck, isPending: h.isPending })
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

import ExportDeckDialog from "@/components/my-cards-page/deck-view/ExportDeckDialog";

const deck = { _id: "deck-1", name: "Orzhov Taxes" };

function renderDialog(onOpenChange = vi.fn()) {
  render(React.createElement(ExportDeckDialog, { deck, open: true, onOpenChange }));
  return onOpenChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.exportDeck.mockResolvedValue({ fileName: "Orzhov Taxes.txt", size: 42 });
  h.isPending = false;
});

describe("ExportDeckDialog", () => {
  it("defaults to a basic TXT export with images disabled", async () => {
    const onOpenChange = renderDialog();
    expect(screen.getByTestId("export-format-txt")).toHaveAttribute("data-state", "checked");
    expect(screen.getByTestId("export-images")).toBeDisabled();
    expect(screen.getByText("PDF only.")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("export-deck-confirm"));

    expect(h.exportDeck).toHaveBeenCalledWith({
      deckId: "deck-1",
      deckName: "Orzhov Taxes",
      options: {
        format: "txt",
        separateByPrinting: false,
        includeOwnership: false,
        includeImages: false
      }
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(h.toastSuccess).toHaveBeenCalledWith("Deck exported", {
      description: "Downloaded Orzhov Taxes.txt."
    });
  });

  it("enables images only for PDF and sends every chosen option", async () => {
    renderDialog();
    await userEvent.click(screen.getByTestId("export-format-pdf"));
    expect(screen.getByTestId("export-images")).toBeEnabled();

    await userEvent.click(screen.getByTestId("export-by-printing"));
    await userEvent.click(screen.getByTestId("export-ownership"));
    await userEvent.click(screen.getByTestId("export-images"));
    await userEvent.click(screen.getByTestId("export-deck-confirm"));

    expect(h.exportDeck).toHaveBeenCalledWith({
      deckId: "deck-1",
      deckName: "Orzhov Taxes",
      options: {
        format: "pdf",
        separateByPrinting: true,
        includeOwnership: true,
        includeImages: true
      }
    });
  });

  it("offers CSV and keeps images disabled for it", async () => {
    renderDialog();
    await userEvent.click(screen.getByTestId("export-format-csv"));
    expect(screen.getByTestId("export-images")).toBeDisabled();
    await userEvent.click(screen.getByTestId("export-deck-confirm"));
    expect(h.exportDeck).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ format: "csv" }) })
    );
  });

  it("drops the images option when switching away from PDF", async () => {
    renderDialog();
    await userEvent.click(screen.getByTestId("export-format-pdf"));
    await userEvent.click(screen.getByTestId("export-images"));
    await userEvent.click(screen.getByTestId("export-format-xlsx"));

    const images = screen.getByTestId("export-images");
    expect(images).toBeDisabled();
    expect(images).toHaveAttribute("data-state", "unchecked");
  });

  it("shows an error toast and stays open when the export fails", async () => {
    h.exportDeck.mockRejectedValueOnce(new Error("Deck not found"));
    const onOpenChange = renderDialog();

    await userEvent.click(screen.getByTestId("export-deck-confirm"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("Failed to export deck", {
        description: "Deck not found"
      })
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("disables the buttons while an export is in flight", () => {
    h.isPending = true;
    renderDialog();
    expect(screen.getByTestId("export-deck-confirm")).toBeDisabled();
    expect(screen.getByText("Exporting…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, FileType2, Table2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useExportDeck } from "@/hooks/react-query/useExportDeck";
import { DEFAULT_DECK_EXPORT_OPTIONS, DeckExportFormat, DeckExportOptions } from "@/lib/deckExport";
import { DeckSummary } from "@/types/Deck";

interface ExportDeckDialogProps {
  deck: Pick<DeckSummary, "_id" | "name">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FORMATS: {
  value: DeckExportFormat;
  label: string;
  description: string;
  icon: typeof FileText;
}[] = [
  {
    value: "txt",
    label: "Text (.txt)",
    description: "Plain decklist, one card per line.",
    icon: FileText
  },
  {
    value: "csv",
    label: "CSV (.csv)",
    description: "One row per card; opens in any spreadsheet.",
    icon: Table2
  },
  {
    value: "xlsx",
    label: "Excel (.xlsx)",
    description: "One row per card with section and count columns.",
    icon: FileSpreadsheet
  },
  {
    value: "pdf",
    label: "PDF (.pdf)",
    description: "Printable decklist, optionally with card images.",
    icon: FileType2
  }
];

/**
 * Dialog that exports a deck as a downloadable file. The user picks a format
 * and the aggregation options; the file itself is rendered server-side by
 * GET /api/decks/[id]/export and handed to the browser as a download.
 */
export default function ExportDeckDialog({ deck, open, onOpenChange }: ExportDeckDialogProps) {
  const [options, setOptions] = useState<DeckExportOptions>(DEFAULT_DECK_EXPORT_OPTIONS);
  const exportDeck = useExportDeck();

  const update = (patch: Partial<DeckExportOptions>) =>
    setOptions((prev) => ({ ...prev, ...patch }));

  const imagesAvailable = options.format === "pdf";

  const handleExport = async () => {
    try {
      const { fileName } = await exportDeck.mutateAsync({
        deckId: deck._id,
        deckName: deck.name,
        options
      });
      toast.success("Deck exported", { description: `Downloaded ${fileName}.` });
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to export deck", {
        description: err instanceof Error ? err.message : "An error occurred."
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-110" data-testid="export-deck-dialog">
        <DialogHeader>
          <DialogTitle>Export Deck</DialogTitle>
          <DialogDescription>
            Download &ldquo;{deck.name}&rdquo; as a decklist. Cards are listed section by section in
            the order they appear in the deck.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">File type</legend>
            <RadioGroup
              value={options.format}
              onValueChange={(value) => update({ format: value as DeckExportFormat })}
              aria-label="File type"
            >
              {FORMATS.map(({ value, label, description, icon: Icon }) => (
                <label
                  key={value}
                  className="hover:bg-muted/50 has-[[data-state=checked]]:border-primary flex cursor-pointer items-start gap-3 rounded-md border p-3"
                >
                  <RadioGroupItem
                    value={value}
                    className="mt-0.5"
                    data-testid={`export-format-${value}`}
                  />
                  <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="text-muted-foreground block text-xs">{description}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">Options</legend>
            <div className="flex items-start gap-3">
              <Checkbox
                id="export-by-printing"
                checked={options.separateByPrinting}
                onCheckedChange={(checked) => update({ separateByPrinting: checked === true })}
                data-testid="export-by-printing"
              />
              <div className="grid gap-0.5">
                <Label htmlFor="export-by-printing">Separate by printing</Label>
                <p className="text-muted-foreground text-xs">
                  List each printing (set and collector number) on its own line instead of combining
                  copies by name.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="export-ownership"
                checked={options.includeOwnership}
                onCheckedChange={(checked) => update({ includeOwnership: checked === true })}
                data-testid="export-ownership"
              />
              <div className="grid gap-0.5">
                <Label htmlFor="export-ownership">Include ownership</Label>
                <p className="text-muted-foreground text-xs">
                  Note how many copies you own versus deck-only placeholders.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="export-images"
                checked={imagesAvailable && options.includeImages}
                disabled={!imagesAvailable}
                onCheckedChange={(checked) => update({ includeImages: checked === true })}
                data-testid="export-images"
              />
              <div className="grid gap-0.5">
                <Label htmlFor="export-images" className={imagesAvailable ? "" : "opacity-60"}>
                  Include card images
                </Label>
                <p className="text-muted-foreground text-xs">
                  {imagesAvailable
                    ? "Lay the deck out as a grid of card images. Larger file; images are fetched from Scryfall."
                    : "PDF only."}
                </p>
              </div>
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={exportDeck.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={exportDeck.isPending}
            data-testid="export-deck-confirm"
          >
            {exportDeck.isPending ? "Exporting…" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

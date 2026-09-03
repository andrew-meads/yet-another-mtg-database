import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  deckId: string;
};

// Uses the read-only "Drag Test Deck" fixture (Shivan Dragon, Llanowar Elves,
// Shivan Dragon in one column): exporting never mutates anything.
test("exports the deck as a text decklist download", async ({ page }) => {
  await page.goto(`/my-cards/decks/${fixtures.deckId}`);
  await expect(page.getByTestId("deck-card-count")).toHaveText("3 cards", { timeout: 15_000 });

  await page.getByLabel("Export deck").click();
  const dialog = page.getByTestId("export-deck-dialog");
  await expect(dialog).toBeVisible();

  // TXT is the default; images are PDF-only so the checkbox starts disabled.
  await expect(dialog.getByTestId("export-format-txt")).toHaveAttribute("data-state", "checked");
  await expect(dialog.getByTestId("export-images")).toBeDisabled();
  await dialog.getByTestId("export-ownership").click();

  const download = page.waitForEvent("download");
  await dialog.getByTestId("export-deck-confirm").click();
  const file = await download;

  expect(file.suggestedFilename()).toBe("Drag Test Deck.txt");
  const text = readFileSync((await file.path())!, "utf-8");
  expect(text).toContain("Drag Test Deck");
  expect(text).toContain("// Main (3)");
  expect(text).toContain("2x Shivan Dragon [owned]");
  expect(text).toContain("1x Llanowar Elves [owned]");

  await expect(dialog).toBeHidden();
});

test("exports the deck as a CSV download", async ({ page }) => {
  await page.goto(`/my-cards/decks/${fixtures.deckId}`);
  await expect(page.getByTestId("deck-card-count")).toHaveText("3 cards", { timeout: 15_000 });

  await page.getByLabel("Export deck").click();
  const dialog = page.getByTestId("export-deck-dialog");
  await dialog.getByTestId("export-format-csv").click();
  await expect(dialog.getByTestId("export-images")).toBeDisabled();

  const download = page.waitForEvent("download");
  await dialog.getByTestId("export-deck-confirm").click();
  const file = await download;

  expect(file.suggestedFilename()).toBe("Drag Test Deck.csv");
  const text = readFileSync((await file.path())!, "utf-8");
  expect(text).toBe(
    ["Section,Count,Name", "Main,2,Shivan Dragon", "Main,1,Llanowar Elves", ""].join("\r\n")
  );
});

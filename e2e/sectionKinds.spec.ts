import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  skDeckId: string;
  skSideSectionId: string;
  skMaybeSectionId: string;
  skMaybeCardId: string;
};

/** Pick a kind from a section's "Section type" dropdown and wait for the save. */
async function setKind(page: Page, sectionId: string, label: string) {
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().includes("/sections")
  );
  await page.getByTestId(`section-kind-select-${sectionId}`).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await saved;
}

// Uses its own deck of ephemeral cards (Main 2, Side 1, Maybe 1) and resets the
// section kinds at the end, so the spec is repeatable and touches nothing else.
test("sideboard and scratch sections change the deck count, look, and export", async ({ page }) => {
  const { skDeckId, skSideSectionId, skMaybeSectionId, skMaybeCardId } = fixtures;
  const deckCount = page.getByTestId("deck-card-count");

  await page.goto(`/my-cards/decks/${skDeckId}`);
  await expect(deckCount).toHaveText("4 cards", { timeout: 15_000 });

  // Sideboard: its card moves from the main count to the sideboard count.
  await setKind(page, skSideSectionId, "Sideboard");
  await expect(deckCount).toHaveText("3 cards + 1 sideboard");
  await expect(page.getByTestId(`section-card-count-${skSideSectionId}`)).toHaveText(
    "1 card in sideboard"
  );

  // Scratch area: not counted at all, and its cards render partly greyscale.
  const maybeCard = page.getByTestId(`deck-card-${skMaybeCardId}`);
  await expect(maybeCard).not.toHaveAttribute("data-muted", "true");
  await setKind(page, skMaybeSectionId, "Scratch area");
  await expect(deckCount).toHaveText("2 cards + 1 sideboard");
  await expect(page.getByTestId(`section-card-count-${skMaybeSectionId}`)).toHaveText(
    "1 card (not counted)"
  );
  await expect(maybeCard).toHaveAttribute("data-muted", "true");
  await expect(maybeCard).toHaveCSS("filter", /grayscale\(0?\.5|grayscale\(50%/);

  // The TXT export lists the sideboard, then the scratch area, after the main deck.
  await page.getByLabel("Export deck").click();
  const dialog = page.getByTestId("export-deck-dialog");
  const download = page.waitForEvent("download");
  await dialog.getByTestId("export-deck-confirm").click();
  const text = readFileSync((await (await download).path())!, "utf-8");
  expect(text).toBe(
    [
      "Section Kinds Deck",
      "2 cards + 1 sideboard (+1 in scratch area)",
      "",
      "// Main (2)",
      "2x Shivan Dragon",
      "",
      "// ===== Sideboard: 1 card =====",
      "",
      "// Side (1)",
      "1x Llanowar Elves",
      "",
      "// ===== Scratch area (not part of the deck): 1 card =====",
      "",
      "// Maybe (1)",
      "1x Llanowar Elves",
      ""
    ].join("\n")
  );

  // Back to normal: everything counts toward the main deck again.
  await setKind(page, skSideSectionId, "Normal");
  await setKind(page, skMaybeSectionId, "Normal");
  await expect(deckCount).toHaveText("4 cards");
  await expect(maybeCard).not.toHaveAttribute("data-muted", "true");
});

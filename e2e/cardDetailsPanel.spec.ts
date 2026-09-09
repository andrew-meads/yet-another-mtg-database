import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  mainCollectionId: string;
};

/**
 * The selected-card panel: image on top, then Text / Copies / Prices tabs. The
 * rules text is visible as soon as a card is selected, the Copies tab lists
 * where the copies live (deck rows nested under their collection) with an
 * open button, and the last tab survives a reload.
 */
test("selecting a card shows its rules text at once, on the Text tab", async ({ page }) => {
  await page.goto("/search");
  const row = page.getByTestId("search-card-e2e-shivan");
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();

  await expect(page.getByRole("tab", { name: "Text" })).toHaveAttribute("aria-selected", "true");
  // `{R}` renders as a mana symbol, so match the words around it.
  const rules = page.getByText(/Shivan Dragon gets \+1\/\+0 until end of turn/);
  await expect(rules.first()).toBeInViewport();
  // Owned copies are counted on the Copies tab without switching to it.
  // (Other specs' fixtures hold Shivan copies too, so only the shape is asserted.)
  await expect(page.getByTestId("copies-tab-count")).toHaveText(/^[2-9]$/);
});

test("the Copies tab nests deck rows under their collection and opens the entity", async ({
  page
}) => {
  await page.goto("/search");
  await page.getByTestId("search-card-e2e-shivan").click();
  await page.getByRole("tab", { name: /Copies/ }).click();

  // Every seeded Shivan copy lives in the Main Collection; some sit in decks (one is the
  // Drag Test Deck's), so the collection row comes first with its deck rows nested after it.
  const rows = page.getByTestId("card-location-row");
  await expect(rows.first()).toHaveAttribute("data-location-type", "collection");
  await expect(rows.first()).toContainText("Main Collection");
  await expect(rows.first().getByTestId("card-location-qty")).toHaveText(/^\d+ \(\d+ free\)$/);
  const deckRow = rows.filter({ hasText: "Drag Test Deck" });
  await expect(deckRow).toHaveAttribute("data-location-type", "deck");
  await expect(deckRow.getByTestId("card-location-qty")).toHaveText("2");
  // The list never needs to scroll sideways in the narrow column.
  const overflow = await page
    .getByTestId("card-locations")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The tab choice is remembered across reloads.
  await page.reload();
  await expect(page.getByRole("tab", { name: /Copies/ })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Open collection Main Collection" }).click();
  await expect(page).toHaveURL(new RegExp(`/my-cards/collections/${fixtures.mainCollectionId}`));
});

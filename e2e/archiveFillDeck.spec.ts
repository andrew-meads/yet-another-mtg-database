import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  mainCollectionId: string;
  afDeckId: string;
};

const deckCardWith = (page: Page, name: string) =>
  page.locator('[data-testid^="deck-card-"]', { hasText: `No image available for ${name}` });

const ephemeralBadges = (page: Page) => page.locator('[data-testid^="ephemeral-badge-"]');

// Uses its own deck + card fixture (Runeclaw Bear) so archiving/filling can't
// perturb the other specs; the deck ends the test in its starting state.
test("archiving swaps real cards for placeholders; filling swaps them back", async ({ page }) => {
  const { mainCollectionId, afDeckId } = fixtures;

  await page.goto(`/my-cards/decks/${afDeckId}`);
  await expect(deckCardWith(page, "Runeclaw Bear")).toHaveCount(1, { timeout: 15_000 });
  await expect(ephemeralBadges(page)).toHaveCount(0);

  // Archive the deck, accepting the confirm() prompt.
  page.on("dialog", (dialog) => dialog.accept());
  const archived = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes(`/api/decks/${afDeckId}/archive`)
  );
  await page.getByLabel("Archive deck").click();
  await archived;

  // The decklist is intact, but the card is now an ephemeral placeholder…
  await expect(ephemeralBadges(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(deckCardWith(page, "Runeclaw Bear")).toHaveCount(1);

  // …and the real copy is back loose in the Main Collection.
  await page.goto(`/my-cards/collections/${mainCollectionId}`);
  await expect(page.getByTestId("collection-row-e2e-runeclaw|||")).toBeVisible({
    timeout: 15_000
  });

  // Fill the deck back from the active collection.
  await page.goto(`/my-cards/decks/${afDeckId}`);
  await expect(ephemeralBadges(page)).toHaveCount(1, { timeout: 15_000 });
  await page.getByLabel("Fill deck").click();

  const candidate = page.locator('[data-testid^="fill-candidate-"]');
  await expect(candidate).toHaveCount(1, { timeout: 15_000 });
  await candidate.click();

  const filled = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes(`/api/decks/${afDeckId}/fill`)
  );
  await page.getByTestId("fill-deck-confirm").click();
  await filled;

  // The placeholder is gone; the real card is back in its slot.
  await expect(ephemeralBadges(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(deckCardWith(page, "Runeclaw Bear")).toHaveCount(1);
});

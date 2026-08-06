import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  mainCollectionId: string;
  activeDeckId: string;
};

/** Seed which entities are "open" (and pinned) before the app boots. */
async function seedOpenEntities(
  page: Page,
  refs: Array<{ id: string; kind: "collection" | "deck"; pinned?: boolean }>
) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("open-entity-ids", JSON.stringify(value));
  }, refs);
}

const deckCardWith = (page: Page, name: string) =>
  page.locator('[data-testid^="deck-card-"]', { hasText: `No image available for ${name}` });

// This is the only spec that activates a deck, and it uses its own deck fixture so
// the shared single-active-deck state can't perturb the other specs.
test("making a deck active lets 'd' add the selected search card to it", async ({ page }) => {
  const { mainCollectionId, activeDeckId } = fixtures;
  // Main Collection is seeded active — the new copy is created there before being
  // placed into the deck.
  await seedOpenEntities(page, [
    { id: mainCollectionId, kind: "collection" },
    { id: activeDeckId, kind: "deck", pinned: true }
  ]);

  await page.goto("/search");
  const deckButton = page.getByTestId(`open-entity-${activeDeckId}`);
  await expect(deckButton).toBeVisible({ timeout: 15_000 });

  // Make the deck active via its context menu.
  const activated = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" && r.url().includes(`/api/decks/${activeDeckId}/isActive`)
  );
  await deckButton.click({ button: "right" });
  await page.getByText("Make active").click();
  await activated;

  // The deck now shows the active star.
  await expect(deckButton.locator(".fill-current")).toBeVisible({ timeout: 15_000 });

  // Select a search result (which also focuses the table) and press "d".
  const row = page.getByTestId("search-card-e2e-shivan");
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();

  const added = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/physical-cards")
  );
  await page.keyboard.press("d");
  await added;

  // The card landed in the deck…
  await page.goto(`/my-cards/decks/${activeDeckId}`);
  await expect(deckCardWith(page, "Shivan Dragon")).toHaveCount(1, { timeout: 15_000 });

  // …as a collection-backed copy, not an ephemeral (deck-only) one.
  await expect(page.locator('[data-testid^="ephemeral-badge-"]')).toHaveCount(0);
});

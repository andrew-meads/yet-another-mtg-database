import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  sideCollectionId: string;
  ephDeckId: string;
  ephSourceColId: string;
  ephEmptyColId: string;
  ephemeralCardId: string;
  otherDeckId: string;
};

/** Shared HTML5 drag helper (see the other drag specs for the rationale). */
async function html5DragAndDrop(page: Page, sourceTestId: string, targetTestId: string) {
  await page.evaluate(
    ({ sourceTestId, targetTestId }) => {
      const source = document.querySelector(`[data-testid="${sourceTestId}"]`);
      const target = document.querySelector(`[data-testid="${targetTestId}"]`);
      if (!source || !target) throw new Error("drag source or target not found");

      const dataTransfer = new DataTransfer();
      const rect = target.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      const fire = (el: Element, type: string) =>
        el.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientX, clientY })
        );

      fire(source, "dragstart");
      fire(target, "dragenter");
      fire(target, "dragover");
      fire(target, "drop");
      fire(source, "dragend");
    },
    { sourceTestId, targetTestId }
  );
}

async function seedOpenEntities(
  page: Page,
  refs: Array<{ id: string; kind: "collection" | "deck"; pinned?: boolean }>
) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("open-entity-ids", JSON.stringify(value));
  }, refs);
}

const plainsCards = (page: Page) =>
  page.locator('[data-testid^="deck-card-"]', { hasText: "No image available for Plains" });

// Note: these tests run serially (workers: 1) and share one deck fixture. The
// reorder test runs first; the no-op tests only assert the ephemeral card stays
// in its deck, so its column position doesn't matter.

test("ephemeral card reorders within its own deck", async ({ page }) => {
  const { ephDeckId, ephEmptyColId, ephemeralCardId } = fixtures;
  await page.goto(`/my-cards/decks/${ephDeckId}`);

  const card = page.getByTestId(`deck-card-${ephemeralCardId}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  // It carries an ephemeral badge (no collection).
  await expect(page.getByTestId(`ephemeral-badge-${ephemeralCardId}`)).toBeVisible();

  await html5DragAndDrop(page, `deck-card-${ephemeralCardId}`, `deck-column-${ephEmptyColId}`);

  // It now lives in the previously-empty column.
  await expect(
    page.locator(
      `[data-testid="deck-column-${ephEmptyColId}"] [data-testid="deck-card-${ephemeralCardId}"]`
    )
  ).toBeVisible({ timeout: 15_000 });
});

test("dragging an ephemeral card onto another deck is a no-op", async ({ page }) => {
  const { ephDeckId, ephemeralCardId, otherDeckId } = fixtures;
  await seedOpenEntities(page, [{ id: otherDeckId, kind: "deck", pinned: true }]);

  await page.goto(`/my-cards/decks/${ephDeckId}`);
  await expect(page.getByTestId(`deck-card-${ephemeralCardId}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`open-entity-${otherDeckId}`)).toBeVisible();

  await html5DragAndDrop(page, `deck-card-${ephemeralCardId}`, `drop-zone-${otherDeckId}`);

  // Card stays in its own deck…
  await expect(page.getByTestId(`deck-card-${ephemeralCardId}`)).toBeVisible();
  // …and the other deck is still empty.
  await page.goto(`/my-cards/decks/${otherDeckId}`);
  await expect(page.locator('[data-testid^="deck-card-"]')).toHaveCount(0, { timeout: 15_000 });
});

test("dragging an ephemeral card onto a collection is a no-op", async ({ page }) => {
  const { ephDeckId, ephemeralCardId, sideCollectionId } = fixtures;
  await seedOpenEntities(page, [{ id: sideCollectionId, kind: "collection", pinned: true }]);

  await page.goto(`/my-cards/decks/${ephDeckId}`);
  await expect(page.getByTestId(`deck-card-${ephemeralCardId}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`open-entity-${sideCollectionId}`)).toBeVisible();

  await html5DragAndDrop(page, `deck-card-${ephemeralCardId}`, `drop-zone-${sideCollectionId}`);

  // Card stays in its deck…
  await expect(page.getByTestId(`deck-card-${ephemeralCardId}`)).toBeVisible();
  // …and never appears in the collection.
  await page.goto(`/my-cards/collections/${sideCollectionId}`);
  await expect(page.getByText("Forest")).toHaveCount(0, { timeout: 15_000 });
});

test("adding basic lands creates ephemeral cards; removing one deletes it", async ({ page }) => {
  const { ephDeckId } = fixtures;
  // Give the land picker popover room so its Add button stays within the viewport.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`/my-cards/decks/${ephDeckId}`);
  await expect(page.getByTestId("add-land-button")).toBeVisible({ timeout: 15_000 });

  // Add 2 Plains via the per-section picker.
  await page.getByTestId("add-land-button").click();
  await page.getByLabel("Increase Plains").click();
  await page.getByLabel("Increase Plains").click();
  await page.getByTestId("add-land-confirm").click();

  await expect(plainsCards(page)).toHaveCount(2, { timeout: 15_000 });

  // Remove one via its context menu — ephemeral cards are deleted entirely.
  // Target the top-of-stack card (last), which isn't overlapped by a sibling.
  await plainsCards(page).last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from deck" }).click();

  await expect(plainsCards(page)).toHaveCount(1, { timeout: 15_000 });
});

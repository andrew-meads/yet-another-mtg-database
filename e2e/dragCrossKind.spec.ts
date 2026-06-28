import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  mainCollectionId: string;
  ckDeckId: string;
  ckSourceDeckId: string;
  ckDeckCardId: string;
  ckTargetCollId: string;
};

/**
 * Simulate an HTML5 drag-and-drop between two elements (selected by data-testid).
 * react-dnd's HTML5 backend listens to native dnd events, which Playwright's
 * synthetic mouse drag does not reliably fire — so we dispatch the event sequence
 * ourselves with a shared DataTransfer. (Shared with the other drag specs.)
 */
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

/**
 * Drag then wait for the resulting mutation to finish. Navigating away before
 * the drop's fetch resolves would cancel it, so we await the matching response
 * (by method + url substring) before the caller navigates.
 */
async function dragAndAwaitResponse(
  page: Page,
  source: string,
  target: string,
  method: string,
  urlPart: string
) {
  const done = page.waitForResponse(
    (r) => r.request().method() === method && r.url().includes(urlPart)
  );
  await html5DragAndDrop(page, source, target);
  await done;
}

// These three cross-kind moves (which change a card's deck membership) previously
// had no E2E coverage. Each uses its own dedicated fixtures so the specs don't
// perturb each other or the existing drag specs.

test("search → deck: a search card dropped on a pinned deck lands in the deck", async ({
  page
}) => {
  const { mainCollectionId, ckDeckId } = fixtures;
  // Main must be open + active so the new card has a collection to be created in.
  await seedOpenEntities(page, [
    { id: mainCollectionId, kind: "collection" },
    { id: ckDeckId, kind: "deck", pinned: true }
  ]);

  await page.goto("/search");
  await expect(page.getByTestId(`open-entity-${ckDeckId}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("search-card-e2e-shivan")).toBeVisible({ timeout: 30_000 });

  await dragAndAwaitResponse(
    page,
    "search-card-e2e-shivan",
    `drop-zone-${ckDeckId}`,
    "POST",
    "/api/physical-cards"
  );

  await page.goto(`/my-cards/decks/${ckDeckId}`);
  await expect(deckCardWith(page, "Shivan Dragon")).toHaveCount(1, { timeout: 15_000 });
});

test("collection → deck: a loose collection card dropped on a pinned deck is placed", async ({
  page
}) => {
  const { mainCollectionId, ckDeckId } = fixtures;
  await seedOpenEntities(page, [
    { id: mainCollectionId, kind: "collection" },
    { id: ckDeckId, kind: "deck", pinned: true }
  ]);

  await page.goto(`/my-cards/collections/${mainCollectionId}`);
  const row = page.getByTestId("collection-row-e2e-llanowar|||");
  await expect(row).toBeVisible({ timeout: 15_000 });

  await expect(page.getByTestId(`open-entity-${ckDeckId}`)).toBeVisible();
  await dragAndAwaitResponse(
    page,
    "collection-row-e2e-llanowar|||",
    `drop-zone-${ckDeckId}`,
    "POST",
    `/api/decks/${ckDeckId}/cards`
  );

  await page.goto(`/my-cards/decks/${ckDeckId}`);
  await expect(deckCardWith(page, "Llanowar Elves")).toHaveCount(1, { timeout: 15_000 });
});

test("deck → collection: a deck card dropped on a pinned collection leaves the deck", async ({
  page
}) => {
  const { ckSourceDeckId, ckDeckCardId, ckTargetCollId } = fixtures;
  await seedOpenEntities(page, [{ id: ckTargetCollId, kind: "collection", pinned: true }]);

  await page.goto(`/my-cards/decks/${ckSourceDeckId}`);
  await expect(page.getByTestId(`deck-card-${ckDeckCardId}`)).toBeVisible({ timeout: 15_000 });

  // deck→collection fires a remove (POST) then a collection-change (PATCH); await
  // the PATCH — the final mutation — so navigation doesn't cancel it.
  await dragAndAwaitResponse(
    page,
    `deck-card-${ckDeckCardId}`,
    `drop-zone-${ckTargetCollId}`,
    "PATCH",
    `/api/physical-cards/${ckDeckCardId}`
  );

  // The card leaves the deck…
  await expect(page.getByTestId(`deck-card-${ckDeckCardId}`)).toHaveCount(0, { timeout: 15_000 });
  // …and now lives loose in the target collection.
  await page.goto(`/my-cards/collections/${ckTargetCollId}`);
  await expect(page.getByText("Shivan Dragon").first()).toBeVisible({ timeout: 15_000 });
});

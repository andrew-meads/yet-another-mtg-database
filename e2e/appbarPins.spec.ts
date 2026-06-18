import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(
  readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")
) as {
  mainCollectionId: string;
  sideCollectionId: string;
};

/**
 * Simulate an HTML5 drag-and-drop between two elements (selected by data-testid).
 * react-dnd's HTML5 backend listens to native dnd events, which Playwright's
 * synthetic mouse drag does not reliably fire — so we dispatch the event sequence
 * ourselves with a shared DataTransfer. (Shared with dragDeck.spec.ts.)
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

test("open collections appear in the AppBar on the search route, and pinning works", async ({
  page
}) => {
  const { mainCollectionId, sideCollectionId } = fixtures;
  await seedOpenEntities(page, [
    { id: mainCollectionId, kind: "collection" }, // active → always pinned inline
    { id: sideCollectionId, kind: "collection" } // unpinned → behind "More"
  ]);

  // The AppBar (and its open-entity strip) must show even off /my-cards.
  await page.goto("/search");

  // Active collection is pinned inline; the unpinned one is not.
  await expect(page.getByTestId(`open-entity-${mainCollectionId}`)).toBeVisible({
    timeout: 15_000
  });
  await expect(page.getByTestId(`open-entity-${sideCollectionId}`)).toHaveCount(0);

  // Pin the side collection from the "More" menu → it becomes an inline button.
  await page.getByTestId("open-entities-more").click();
  await page.getByTestId(`pin-toggle-${sideCollectionId}`).click();
  await expect(page.getByTestId(`open-entity-${sideCollectionId}`)).toBeVisible();
});

test("a pinned collection button is a drop target for search cards", async ({ page }) => {
  const { mainCollectionId, sideCollectionId } = fixtures;
  await seedOpenEntities(page, [
    { id: mainCollectionId, kind: "collection" },
    { id: sideCollectionId, kind: "collection", pinned: true }
  ]);

  await page.goto("/search");

  // The pinned side collection renders inline, and the search results are loaded.
  await expect(page.getByTestId(`open-entity-${sideCollectionId}`)).toBeVisible({
    timeout: 15_000
  });
  await expect(page.getByTestId("search-card-e2e-shivan")).toBeVisible({ timeout: 30_000 });

  // Drag a search card onto the pinned collection button.
  await html5DragAndDrop(page, "search-card-e2e-shivan", `open-entity-${sideCollectionId}`);

  // The card now lives in the (previously empty) Side Binder collection.
  await page.goto(`/my-cards/collections/${sideCollectionId}`);
  await expect(page.getByText("Shivan Dragon").first()).toBeVisible({ timeout: 15_000 });
});

import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  deckId: string;
  sectionId: string;
  columnA: string;
  columnB: string;
  physicalCardIds: string[];
};

/**
 * Simulate an HTML5 drag-and-drop between two elements (selected by data-testid).
 * react-dnd's HTML5 backend listens to native dnd events, which Playwright's
 * synthetic mouse drag does not reliably fire — so we dispatch the event sequence
 * ourselves with a shared DataTransfer.
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

test("dragging a middle card moves it plus every card on top of it", async ({ page }) => {
  const [pA0, pA1, pA2] = fixtures.physicalCardIds;
  const colA = `[data-testid="deck-column-${fixtures.columnA}"]`;
  const colB = `[data-testid="deck-column-${fixtures.columnB}"]`;

  await page.goto(`/my-cards/decks/${fixtures.deckId}`);

  // Initial arrangement: all three cards in column A, column B empty.
  await expect(page.locator(`${colA} [data-testid="deck-card-${pA0}"]`)).toBeVisible({
    timeout: 15_000
  });
  await expect(page.locator(`${colA} [data-testid="deck-card-${pA2}"]`)).toBeVisible();

  // Grab the MIDDLE card and drop it into column B. It should carry the card
  // after it (pA2) along too, while pA0 (above it) stays put.
  await html5DragAndDrop(page, `deck-card-${pA1}`, `deck-column-${fixtures.columnB}`);

  // pA1 and pA2 now live in column B…
  await expect(page.locator(`${colB} [data-testid="deck-card-${pA1}"]`)).toBeVisible({
    timeout: 15_000
  });
  await expect(page.locator(`${colB} [data-testid="deck-card-${pA2}"]`)).toBeVisible();

  // …in that order (pA1 before pA2).
  const colBCardIds = await page
    .locator(`${colB} [data-testid^="deck-card-"]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  expect(colBCardIds).toEqual([`deck-card-${pA1}`, `deck-card-${pA2}`]);

  // pA0 remains alone in column A.
  await expect(page.locator(`${colA} [data-testid="deck-card-${pA0}"]`)).toBeVisible();
  await expect(page.locator(`${colA} [data-testid="deck-card-${pA1}"]`)).toHaveCount(0);
  await expect(page.locator(`${colA} [data-testid="deck-card-${pA2}"]`)).toHaveCount(0);
});

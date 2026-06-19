import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(
  readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")
) as {
  mainCollectionId: string;
  sideCollectionId: string;
};

/** The grouped-row key for the loose (no deck/notes/tags) Grizzly Bears copies. */
const GRIZZLY_ROW = "collection-row-e2e-grizzly|||";

/**
 * Simulate an HTML5 drag-and-drop between two elements (selected by data-testid).
 * react-dnd's HTML5 backend listens to native dnd events, which Playwright's synthetic
 * mouse drag does not reliably fire — so we dispatch the event sequence ourselves with a
 * shared DataTransfer. (Shared with dragDeck.spec.ts / appbarPins.spec.ts.)
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

async function seedOpenEntities(
  page: Page,
  refs: Array<{ id: string; kind: "collection" | "deck"; pinned?: boolean }>
) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("open-entity-ids", JSON.stringify(value));
  }, refs);
}

test("dragging with the drag-count control moves only the chosen number of copies", async ({
  page
}) => {
  const { mainCollectionId, sideCollectionId } = fixtures;
  await seedOpenEntities(page, [
    { id: mainCollectionId, kind: "collection" }, // active → pinned inline
    { id: sideCollectionId, kind: "collection", pinned: true } // drop target in the app bar
  ]);

  await page.goto(`/my-cards/collections/${mainCollectionId}`);

  // The pinned Side Binder button (drop target) and the two loose Grizzly copies are present.
  await expect(page.getByTestId(`open-entity-${sideCollectionId}`)).toBeVisible({
    timeout: 15_000
  });
  const row = page.getByTestId(GRIZZLY_ROW);
  await expect(row).toBeVisible();
  await expect(row.getByRole("spinbutton")).toHaveValue("2");

  // Reveal the hover drag-count control and dial it down from 2 to 1.
  await row.hover();
  await row.getByLabel("Decrease drag amount").click();

  // Drag the row onto the Side Binder button — only the single chosen copy should move.
  await html5DragAndDrop(page, GRIZZLY_ROW, `drop-zone-${sideCollectionId}`);

  // One copy remains loose in the Main Collection…
  await expect(row.getByRole("spinbutton")).toHaveValue("1", { timeout: 15_000 });

  // …and exactly one copy landed in the Side Binder.
  await page.goto(`/my-cards/collections/${sideCollectionId}`);
  const sideRow = page.getByTestId(GRIZZLY_ROW);
  await expect(sideRow).toBeVisible({ timeout: 15_000 });
  await expect(sideRow.getByRole("spinbutton")).toHaveValue("1");
});

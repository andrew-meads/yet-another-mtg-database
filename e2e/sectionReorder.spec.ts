import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  srDeckId: string;
  srSectionIds: string[];
};

/**
 * Drag a section by its grip handle and drop it on the given half of another section.
 * react-dnd's HTML5 backend listens to native dnd events, which Playwright's synthetic
 * mouse drag does not reliably fire, so the event sequence is dispatched by hand
 * (as in dragDeck.spec.ts), with the pointer placed inside the chosen half.
 */
async function dragSection(
  page: Page,
  sectionId: string,
  targetSectionId: string,
  position: "before" | "after"
) {
  await page.evaluate(
    ({ sectionId, targetSectionId, position }) => {
      const source = document.querySelector(`[data-testid="section-drag-handle-${sectionId}"]`);
      const target = document.querySelector(`[data-testid="deck-section-${targetSectionId}"]`);
      if (!source || !target) throw new Error("section drag source or target not found");

      const dataTransfer = new DataTransfer();
      const rect = target.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height * (position === "before" ? 0.25 : 0.75);
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
    { sectionId, targetSectionId, position }
  );
}

/** The deck page's section ids, top to bottom. */
async function sectionOrder(page: Page) {
  return page
    .locator('[data-testid^="deck-section-"]')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-testid")!.replace("deck-section-", ""))
    );
}

/** Wait for the reorder PATCH the next drop sends. */
function reorderSaved(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      /\/api\/decks\/[^/]+\/sections$/.test(r.url()) &&
      (r.request().postData() ?? "").includes('"order"')
  );
}

test("drags sections into a new order that survives a reload", async ({ page }) => {
  const { srDeckId } = fixtures;
  const [creatures, spells, lands] = fixtures.srSectionIds;

  await page.goto(`/my-cards/decks/${srDeckId}`);
  await expect(page.getByTestId(`section-drag-handle-${creatures}`)).toBeVisible({
    timeout: 15_000
  });
  expect(await sectionOrder(page)).toEqual([creatures, spells, lands]);

  // Creatures (with its card) onto the bottom half of Lands: it moves to the end.
  let saved = reorderSaved(page);
  await dragSection(page, creatures, lands, "after");
  expect((await saved).status()).toBe(200);
  await expect.poll(() => sectionOrder(page)).toEqual([spells, lands, creatures]);
  await expect(
    page.getByTestId(`deck-section-${creatures}`).locator('[data-testid^="deck-card-"]')
  ).toHaveCount(1);

  await page.reload();
  await expect(page.getByTestId(`section-drag-handle-${creatures}`)).toBeVisible({
    timeout: 15_000
  });
  expect(await sectionOrder(page)).toEqual([spells, lands, creatures]);

  // And back onto the top half of Spells, restoring the seeded order.
  saved = reorderSaved(page);
  await dragSection(page, creatures, spells, "before");
  expect((await saved).status()).toBe(200);
  await expect.poll(() => sectionOrder(page)).toEqual([creatures, spells, lands]);
});

test("dropping a section next to itself sends nothing", async ({ page }) => {
  const [creatures, spells] = fixtures.srSectionIds;
  await page.goto(`/my-cards/decks/${fixtures.srDeckId}`);
  await expect(page.getByTestId(`section-drag-handle-${creatures}`)).toBeVisible({
    timeout: 15_000
  });

  const patches: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "PATCH" && /\/sections$/.test(req.url())) patches.push(req.url());
  });
  // The top half of the section right below it is the gap it already occupies.
  await dragSection(page, creatures, spells, "before");
  await dragSection(page, creatures, creatures, "after");
  await page.waitForTimeout(500);
  expect(patches).toEqual([]);
});

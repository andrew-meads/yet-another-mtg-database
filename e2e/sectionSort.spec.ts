import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  ssDeckId: string;
  ssSectionId: string;
  ssIslandId: string;
  ssShivanId: string;
  ssLlanowarId: string;
};

/** Pick a mode from a section's Sort menu and wait for the sort to save. */
async function sortSection(page: Page, sectionId: string, label: string) {
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/sections/sort")
  );
  await page.getByTestId(`section-sort-${sectionId}`).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  expect((await saved).status()).toBe(200);
}

/** The physical-card ids in each column of the page's (only) section, left to right. */
async function columnContents(page: Page) {
  return page
    .locator('[data-testid^="deck-column-"]')
    .evaluateAll((columns) =>
      columns.map((col) =>
        [...col.querySelectorAll('[data-testid^="deck-card-"]')].map((el) =>
          el.getAttribute("data-testid")!.replace("deck-card-", "")
        )
      )
    );
}

// Island (land), Shivan Dragon (MV 6, red), Llanowar Elves (MV 1, green).
test("sorts a section into mana value columns, then color columns", async ({ page }) => {
  const { ssDeckId, ssSectionId, ssIslandId, ssShivanId, ssLlanowarId } = fixtures;
  await page.goto(`/my-cards/decks/${ssDeckId}`);
  await expect(page.getByTestId(`deck-card-${ssShivanId}`)).toBeVisible({ timeout: 15_000 });

  // MV 1..6 with empty placeholders for 2-5, then the lands column.
  await sortSection(page, ssSectionId, "Mana value");
  await expect
    .poll(() => columnContents(page))
    .toEqual([[ssLlanowarId], [], [], [], [], [ssShivanId], [ssIslandId]]);

  // Red, green, then lands.
  await sortSection(page, ssSectionId, "Color, then mana value");
  await expect
    .poll(() => columnContents(page))
    .toEqual([[ssShivanId], [ssLlanowarId], [ssIslandId]]);
});

import { test, expect } from "@playwright/test";

test("lists seeded cards and filters by a query", async ({ page }) => {
  await page.goto("/search");

  // Default (no query) shows all seeded cards.
  await expect(page.getByText("Shivan Dragon").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Llanowar Elves").first()).toBeVisible();

  // A bare-name query narrows to the matching card.
  await page.getByPlaceholder(/Try:|Search/).fill("dragon");
  await expect(page.getByText("Shivan Dragon").first()).toBeVisible();
  await expect(page.getByText("Llanowar Elves")).toHaveCount(0);
});

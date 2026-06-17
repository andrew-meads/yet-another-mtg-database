import { test, expect } from "@playwright/test";

test.describe("unauthenticated", () => {
  // Drop the authenticated storageState for these tests.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("redirects to the login page", async ({ page }) => {
    await page.goto("/search");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: /sign in with google/i })).toBeVisible();
  });
});

test("authenticated user reaches the search page", async ({ page }) => {
  await page.goto("/search");
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByPlaceholder(/Try:|Search/)).toBeVisible();
});

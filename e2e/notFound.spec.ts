import { test, expect } from "@playwright/test";

test("an unknown URL renders the mascot 404 page with a 404 status", async ({ page }) => {
  const response = await page.goto("/this/page/does/not/exist");
  expect(response?.status()).toBe(404);

  await expect(page.getByRole("heading", { name: "Noughty ate this page" })).toBeVisible();
  await expect(page.getByRole("img", { name: /eating a torn web page/ })).toBeVisible();

  await page.getByRole("link", { name: "Take me home" }).click();
  await expect(page).toHaveURL(/\/search$/);
});

test.describe("unknown entity ids", () => {
  for (const path of ["/my-cards/collections/doesnt-exist", "/my-cards/decks/doesnt-exist"]) {
    test(`${path} renders the mascot 404 page`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Noughty ate this page" })).toBeVisible();
      await expect(page.getByRole("img", { name: /eating a torn web page/ })).toBeVisible();
    });
  }
});
